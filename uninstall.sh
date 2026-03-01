#!/bin/bash

# Default values
OFFSET_ENV="offset-env"
INSTALL_DIR="$HOME/offset"
SERVICE_NAME="offset.service"
MOONRAKER_CONF="$HOME/printer_data/config/moonraker.conf"
MOONRAKER_ASVC="$HOME/printer_data/moonraker.asvc"
KLIPPER_EXTRAS="$HOME/klipper/klippy/extras/offset.py"

echo "Uninstalling Offset..."

# Stop and disable the service
echo "Stopping and disabling Offset service..."
sudo systemctl stop ${SERVICE_NAME} 2>/dev/null || true
sudo systemctl disable ${SERVICE_NAME} 2>/dev/null || true

# Remove service file
echo "Removing service file..."
sudo rm -f /etc/systemd/system/${SERVICE_NAME}
sudo systemctl daemon-reload

# Deactivate virtual environment if active
if [ -n "$VIRTUAL_ENV" ]; then
    echo "Deactivating virtual environment..."
    deactivate
fi

# Remove installation directory
if [ -d "${INSTALL_DIR}" ]; then
    echo "Removing installation directory..."
    rm -rf "${INSTALL_DIR}"
fi

# Check for backup and offer to remove it
if [ -d "${INSTALL_DIR}.bak" ]; then
    read -p "Backup directory found at ${INSTALL_DIR}.bak. Remove it? (y/N) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo "Removing backup directory..."
        rm -rf "${INSTALL_DIR}.bak"
    fi
fi

# Remove from moonraker.asvc
if [ -f "${MOONRAKER_ASVC}" ]; then
    echo "Removing from moonraker.asvc..."
    sed -i '/^offset$/d' "${MOONRAKER_ASVC}"
fi

# Remove update_manager block cleanly
if [ -f "${MOONRAKER_CONF}" ]; then
    echo "Removing update manager configuration..."
    awk '
        BEGIN{skip=0}
        /^\[update_manager offset\]/{skip=1; next}
        /^\[.*\]/{if(skip==1){skip=0}}
        skip==0{print}
    ' "${MOONRAKER_CONF}" > "${MOONRAKER_CONF}.tmp"
    mv "${MOONRAKER_CONF}.tmp" "${MOONRAKER_CONF}"
fi

# Remove symlink from klipper extras
echo "Removing symlink from klipper extras..."
if [ -L "${KLIPPER_EXTRAS}" ]; then
    sudo rm -f "${KLIPPER_EXTRAS}"
fi

# Restart services
echo "Restarting services..."
sudo systemctl restart moonraker 2>/dev/null || true
sudo systemctl restart klipper 2>/dev/null || true

echo "Offset (Offset-V2) has been uninstalled successfully!"
