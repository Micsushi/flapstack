#!/bin/sh
set -eu

# flapstack-install-mode-v1
test -d "/opt/Flapstack"
test ! -L "/opt/Flapstack"
test -d "/opt/Flapstack/resources"
test ! -L "/opt/Flapstack/resources"
chmod 0755 -- "/opt/Flapstack"
chmod 0755 -- "/opt/Flapstack/resources"
