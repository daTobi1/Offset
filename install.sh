#!/bin/bash
set -euo pipefail

# =============================
# Offset Installer (clean)
# - Repo:      ~/offset
# - Venv:      ~/offset-env   (outside repo -> no "dirty" updates)
# - Service:   offset.service
# - Moonraker: moonraker.asvc + [update_manager offset]
# - Klipper:   symlink extras/offset.py
# =============================

# Defaults
APP_NAME="offset"
INSTALL_DIR="${HOME}/offset"
REPO_URL="https://github.com/daTobi1/Offset.git"
BRANCH="main"

# venv outside repo (fix dirty repo)
VENV_DIR="${HOME}/offset-env"

# Klipper extra name (adjust if your file is still offset.py)
EXTRA_NAME="offset.py"
EXTRA_SRC="${INSTALL_DIR}/klippy/extras/${EXTRA_NAME}"
EXTRA_DST="${HOME}/klipper/klippy/extras/${EXTRA_NAME}"

# moonraker paths
ASVC_FILE="${HOME}/printer_data/moonraker.asvc"
MOONRAKER_CONF="${HOME}/printer_data/config/moonraker.conf"

# Parse args
while [[ $# -gt 0 ]]; do
  case $1 in
    --branch)
      BRANCH="$2"
      shift 2
      ;;
    *)
      echo "Unknown parameter: $1"
      exit 1
      ;;
  esac
done

# Refuse root
if [ "${EUID}" -eq 0 ]; then
  echo "Please do not run as root/sudo. Installation will prompt for sudo when needed."
  exit 1
fi

echo "Installing Offset..."
echo "Repository: ${REPO_URL}"
echo "Branch:     ${BRANCH}"
echo "Install to: ${INSTALL_DIR}"
echo "Venv:       ${VENV_DIR}"
echo

cd "${HOME}"

# Backup existing install
if [ -d "${INSTALL_DIR}" ]; then
  echo "Existing installation found at ${INSTALL_DIR}"
  echo "Backing up to ${INSTALL_DIR}.bak ..."
  rm -rf "${INSTALL_DIR}.bak" || true
  mv "${INSTALL_DIR}" "${INSTALL_DIR}.bak"
fi

# Clone repo
echo "Cloning repository..."
git clone -b "${BRANCH}" "${REPO_URL}" "${INSTALL_DIR}"

# Ensure gitignore (safety net)
echo "Ensuring .gitignore ignores venv and caches..."
GITIGNORE_FILE="${INSTALL_DIR}/.gitignore"
touch "${GITIGNORE_FILE}"

# append only if not already present
append_if_missing() {
  local line="$1"
  local file="$2"
  grep -qxF "${line}" "${file}" 2>/dev/null || echo "${line}" >> "${file}"
}

append_if_missing "" "${GITIGNORE_FILE}"
append_if_missing "# Python venv (must never be tracked)" "${GITIGNORE_FILE}"
append_if_missing "offset-env/" "${GITIGNORE_FILE}"
append_if_missing ".venv/" "${GITIGNORE_FILE}"
append_if_missing "" "${GITIGNORE_FILE}"
append_if_missing "# Python caches" "${GITIGNORE_FILE}"
append_if_missing "__pycache__/" "${GITIGNORE_FILE}"
append_if_missing "*.pyc" "${GITIGNORE_FILE}"

# If someone accidentally tracked a venv previously, remove it from index (doesn't delete files)
echo "Cleaning any tracked venv from git index (best effort)..."
(
  cd "${INSTALL_DIR}"
  git rm -r --cached offset-env >/dev/null 2>&1 || true
) || true

# Dependencies
echo "Checking for python3-venv..."
if ! dpkg -l | grep -q python3-venv; then
  echo "python3-venv not found. Installing..."
  sudo apt-get update
  sudo apt-get install -y python3-venv
else
  echo "python3-venv is already installed"
fi

echo "Verifying python3 venv functionality..."
python3 -m venv --help >/dev/null 2>&1 || {
  echo "Error: python3 venv module not working properly"
  echo "Trying to fix by reinstalling python3-venv..."
  sudo apt-get install --reinstall -y python3-venv
}

# Create venv outside repo (and avoid symlink issues)
echo "Setting up Python virtual environment (outside repo)..."
if [ -d "${VENV_DIR}" ]; then
  echo "Existing venv found at ${VENV_DIR} - backing up to ${VENV_DIR}.bak"
  rm -rf "${VENV_DIR}.bak" || true
  mv "${VENV_DIR}" "${VENV_DIR}.bak"
fi

python3 -m venv --copies "${VENV_DIR}"

if [ ! -f "${VENV_DIR}/bin/activate" ]; then
  echo "Virtual environment files not created properly at ${VENV_DIR}"
  exit 1
fi

echo "Activating virtual environment..."
# shellcheck disable=SC1090
source "${VENV_DIR}/bin/activate"

if [[ "${VIRTUAL_ENV}" != "${VENV_DIR}" ]]; then
  echo "Virtual environment not activated correctly"
  exit 1
fi

echo "Installing Python dependencies..."
pip install --upgrade pip
pip install flask waitress

# Create systemd service
echo "Creating service file..."
SERVICE_FILE="${INSTALL_DIR}/${APP_NAME}.service"
cat > "${SERVICE_FILE}" <<EOL
[Unit]
Description=Offset - Tool Alignment Interface for Klipper (based on Offset)
After=network.target moonraker.service
StartLimitIntervalSec=0

[Service]
Type=simple
User=${USER}
WorkingDirectory=${INSTALL_DIR}
ExecStart=${VENV_DIR}/bin/python3 -m flask run --host=0.0.0.0 --port=3000
Environment="PATH=${VENV_DIR}/bin"
Environment="FLASK_APP=app.py"
Restart=always
RestartSec=1

[Install]
WantedBy=multi-user.target
EOL

sudo cp "${SERVICE_FILE}" "/etc/systemd/system/${APP_NAME}.service"
sudo systemctl daemon-reload

# Register service for moonraker (asvc)
echo "Adding to moonraker.asvc..."
mkdir -p "$(dirname "${ASVC_FILE}")"
touch "${ASVC_FILE}"

if ! grep -q "^${APP_NAME}$" "${ASVC_FILE}"; then
  [ -s "${ASVC_FILE}" ] && echo >> "${ASVC_FILE}"
  echo "${APP_NAME}" >> "${ASVC_FILE}"
  echo "Added ${APP_NAME} to moonraker.asvc"
else
  echo "${APP_NAME} already in moonraker.asvc"
fi

# Update Manager section
echo "Adding update manager configuration..."
if [ -f "${MOONRAKER_CONF}" ]; then
  if ! grep -q "^\[update_manager ${APP_NAME}\]" "${MOONRAKER_CONF}"; then
    cat >> "${MOONRAKER_CONF}" <<EOL


[update_manager ${APP_NAME}]
type: git_repo
path: ${INSTALL_DIR}
origin: ${REPO_URL}
primary_branch: ${BRANCH}
is_system_service: True
managed_services: ${APP_NAME}
EOL
    echo "Added update manager configuration to moonraker.conf"
  else
    echo "Update manager configuration already exists"
  fi
else
  echo "Warning: moonraker.conf not found in expected location: ${MOONRAKER_CONF}"
fi

# Enable + start service
echo "Enabling and starting ${APP_NAME} service..."
sudo systemctl enable "${APP_NAME}.service"
sudo systemctl restart "${APP_NAME}.service"

# Restart moonraker (so it sees service + update_manager)
echo "Restarting moonraker..."
sudo systemctl restart moonraker

# Klipper extra symlink
echo "Adding symlink into klipper extras..."
if [ ! -f "${EXTRA_SRC}" ]; then
  echo "WARNING: Extra file not found: ${EXTRA_SRC}"
  echo "If your extra is still named offset.py, set EXTRA_NAME=\"offset.py\" in install.sh."
else
  sudo ln -sf "${EXTRA_SRC}" "${EXTRA_DST}"
  sudo systemctl restart klipper
fi

echo
echo "Installation complete!"
PRINTER_IP=$(hostname -I | awk '{print $1}')
echo "When running, it will be hosted at http://${PRINTER_IP}:3000"
echo "Service: ${APP_NAME}.service"
echo "Repo:    ${INSTALL_DIR}"
echo "Venv:    ${VENV_DIR}"
