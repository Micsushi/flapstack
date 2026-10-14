#!/bin/sh
set -eu

# flapstack-install-mode-v1
test -d "/opt/Flapstack-Preview"
test ! -L "/opt/Flapstack-Preview"
test -d "/opt/Flapstack-Preview/resources"
test ! -L "/opt/Flapstack-Preview/resources"
chmod 0755 -- "/opt/Flapstack-Preview"
chmod 0755 -- "/opt/Flapstack-Preview/resources"
find "/opt/Flapstack-Preview" -type d -exec chmod 0755 -- {} +

test -f "/opt/Flapstack-Preview/chrome-sandbox"
test ! -L "/opt/Flapstack-Preview/chrome-sandbox"
chown root:root -- "/opt/Flapstack-Preview/chrome-sandbox"
chmod 4755 -- "/opt/Flapstack-Preview/chrome-sandbox"
