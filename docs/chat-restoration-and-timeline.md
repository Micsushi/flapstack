# Chat restoration and transcript navigation

Returning to a cached Chat may restore a saved assistant answer even when the
message count has not changed. Restoration replaces only an empty assistant
placeholder with the same message identity. Nonempty local output, tool state,
optimistic messages, and active streams are not overwritten by this recovery.
Persistence observed during a submitted or streaming run is deferred rather than
marked as already hydrated, so it can be reconsidered after the run is idle.

The desktop transcript rail keeps its markers visible without a preliminary
hover or click. Hover and keyboard focus still reveal public prompt/response
previews. Private reasoning is excluded. Existing short-Chat suppression and
small-screen visibility rules remain unchanged.

Regression tests cover empty-placeholder restoration, preservation of local
state, deferred hydration, and a real AI SDK Chat/view subscription. Timeline
tests cover the always-visible marker stack. Isolated browser evidence checks
the actual rail component and its jump callback; it does not replace a full
packaged-app navigation walkthrough.
