#!/bin/bash

SCRIPT_RELATIVE_DIR=$(dirname "${BASH_SOURCE[0]}")
cd $SCRIPT_RELATIVE_DIR
#bash install.sh
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"  # This loads nvm
[ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"  # This loads nvm bash_completion
#nvm install node
nvm use node
npm install #forever
forever stop HoMbot