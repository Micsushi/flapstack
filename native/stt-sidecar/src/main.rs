use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use std::io::{self, BufRead, Lines, StdinLock, Write};
use transcribe_cpp::{
    init_backends_default, CommitPolicy, Model, RunOptions, Session, StreamOptions,
};

#[derive(Deserialize)]
#[serde(tag = "command", rename_all = "snake_case")]
enum Command {
    Load { id: u64, model_path: String },
    Start { id: u64 },
    Feed { id: u64, pcm_base64: String },
    Finalize { id: u64 },
    Cancel { id: u64 },
    Unload { id: u64 },
    Ping { id: u64 },
}

impl Command {
    fn id(&self) -> u64 {
        match self {
            Self::Load { id, .. }
            | Self::Start { id }
            | Self::Feed { id, .. }
            | Self::Finalize { id }
            | Self::Cancel { id }
            | Self::Unload { id }
            | Self::Ping { id } => *id,
        }
    }
}

#[derive(Serialize)]
struct Response {
    id: u64,
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    committed: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tentative: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    final_text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

fn response(id: u64) -> Response {
    Response {
        id,
        ok: true,
        committed: None,
        tentative: None,
        final_text: None,
        error: None,
    }
}

fn failure(id: u64, error: impl ToString) -> Response {
    Response {
        error: Some(error.to_string()),
        ok: false,
        ..response(id)
    }
}

fn emit(stdout: &mut impl Write, value: Response) {
    let _ = writeln!(stdout, "{}", serde_json::to_string(&value).unwrap());
    let _ = stdout.flush();
}

fn next_command(lines: &mut Lines<StdinLock<'_>>) -> Option<Result<Command, String>> {
    lines.next().map(|line| {
        let line = line.map_err(|error| error.to_string())?;
        serde_json::from_str(&line).map_err(|error| error.to_string())
    })
}

fn decode_pcm(value: &str) -> Result<Vec<f32>, String> {
    let bytes = STANDARD.decode(value).map_err(|error| error.to_string())?;
    if bytes.len() % 4 != 0 {
        return Err("PCM payload is not float32-aligned".into());
    }
    Ok(bytes
        .chunks_exact(4)
        .map(|chunk| f32::from_le_bytes(chunk.try_into().unwrap()))
        .collect())
}

fn run_stream(
    start_id: u64,
    session: &mut Session,
    lines: &mut Lines<StdinLock<'_>>,
    stdout: &mut impl Write,
) {
    let options = StreamOptions {
        commit_policy: CommitPolicy::Auto,
        ..Default::default()
    };
    let mut stream = match session.stream(&RunOptions::default(), &options) {
        Ok(stream) => stream,
        Err(error) => {
            emit(stdout, failure(start_id, error));
            return;
        }
    };
    emit(stdout, response(start_id));
    while let Some(command) = next_command(lines) {
        let command = match command {
            Ok(command) => command,
            Err(error) => {
                emit(stdout, failure(0, error));
                continue;
            }
        };
        match command {
            Command::Feed { id, pcm_base64 } => {
                let result = decode_pcm(&pcm_base64)
                    .and_then(|pcm| stream.feed(&pcm).map_err(|error| error.to_string()));
                match result {
                    Ok(_) => {
                        let text = stream.text();
                        emit(
                            stdout,
                            Response {
                                committed: Some(text.committed),
                                tentative: Some(text.tentative),
                                ..response(id)
                            },
                        );
                    }
                    Err(error) => emit(stdout, failure(id, error)),
                }
            }
            Command::Finalize { id } => {
                match stream.finalize() {
                    Ok(_) => emit(
                        stdout,
                        Response {
                            final_text: Some(stream.text().display()),
                            ..response(id)
                        },
                    ),
                    Err(error) => emit(stdout, failure(id, error)),
                }
                return;
            }
            Command::Cancel { id } => {
                stream.reset();
                emit(stdout, response(id));
                return;
            }
            other => emit(
                stdout,
                failure(other.id(), "Command is not valid during a stream"),
            ),
        }
    }
}

fn main() {
    transcribe_cpp::disable_logging();
    let _ = init_backends_default();
    let stdin = io::stdin();
    let mut lines = stdin.lock().lines();
    let mut stdout = io::BufWriter::new(io::stdout().lock());
    let mut model: Option<Model> = None;
    let mut session: Option<Session> = None;

    while let Some(command) = next_command(&mut lines) {
        let command = match command {
            Ok(command) => command,
            Err(error) => {
                emit(&mut stdout, failure(0, error));
                continue;
            }
        };
        match command {
            Command::Ping { id } => emit(&mut stdout, response(id)),
            Command::Load { id, model_path } => match Model::load(&model_path) {
                Ok(loaded) if loaded.capabilities().supports_streaming => match loaded.session() {
                    Ok(loaded_session) => {
                        session = Some(loaded_session);
                        model = Some(loaded);
                        emit(&mut stdout, response(id));
                    }
                    Err(error) => emit(&mut stdout, failure(id, error)),
                },
                Ok(_) => emit(
                    &mut stdout,
                    failure(id, "Selected model does not support streaming"),
                ),
                Err(error) => emit(&mut stdout, failure(id, error)),
            },
            Command::Start { id } => match session.as_mut() {
                Some(session) => run_stream(id, session, &mut lines, &mut stdout),
                None => emit(&mut stdout, failure(id, "Model is not loaded")),
            },
            Command::Unload { id } => {
                session = None;
                model = None;
                emit(&mut stdout, response(id));
            }
            other => emit(
                &mut stdout,
                failure(other.id(), "Start a stream before sending audio"),
            ),
        }
    }
    drop(session);
    drop(model);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_session_commands_with_request_ids() {
        let start: Command = serde_json::from_str(r#"{"command":"start","id":42}"#).unwrap();
        let cancel: Command = serde_json::from_str(r#"{"command":"cancel","id":43}"#).unwrap();
        assert_eq!(start.id(), 42);
        assert_eq!(cancel.id(), 43);
    }

    #[test]
    fn decodes_little_endian_float_pcm() {
        let bytes = [0.25_f32.to_le_bytes(), (-0.5_f32).to_le_bytes()].concat();
        let decoded = decode_pcm(&STANDARD.encode(bytes)).unwrap();
        assert_eq!(decoded, vec![0.25, -0.5]);
    }

    #[test]
    fn rejects_unaligned_pcm() {
        assert!(decode_pcm(&STANDARD.encode([1_u8, 2, 3])).is_err());
    }
}
