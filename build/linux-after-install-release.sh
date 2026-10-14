#!/bin/sh
set -eu

# flapstack-install-mode-v1
test -d "/opt/Flapstack"
test ! -L "/opt/Flapstack"
test -d "/opt/Flapstack/resources"
test ! -L "/opt/Flapstack/resources"
chmod 0755 -- "/opt/Flapstack"
chmod 0755 -- "/opt/Flapstack/resources"
find "/opt/Flapstack" -type d -exec chmod 0755 -- {} +

test -f "/opt/Flapstack/chrome-sandbox"
test ! -L "/opt/Flapstack/chrome-sandbox"
chown root:root -- "/opt/Flapstack/chrome-sandbox"
chmod 4755 -- "/opt/Flapstack/chrome-sandbox"
