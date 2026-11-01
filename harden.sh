#!/usr/bin/env bash
# One-time droplet hardening. Run ONCE as root on a fresh Ubuntu 26.04 droplet.
# Usage: DEPLOY_PUBKEY="ssh-ed25519 AAAA..." ./harden.sh
set -euo pipefail

: "${DEPLOY_PUBKEY:?Set DEPLOY_PUBKEY to the public key the deploy user will use}"
DEPLOY_USER="deploy"

echo "==> System updates"
apt-get update -q && apt-get upgrade -yq
apt-get install -yq ufw fail2ban unattended-upgrades ca-certificates curl git

echo "==> Automatic security updates"
dpkg-reconfigure -f noninteractive unattended-upgrades

echo "==> Deploy user (no password, key only)"
if ! id "$DEPLOY_USER" &>/dev/null; then
  adduser --disabled-password --gecos "" "$DEPLOY_USER"
fi
mkdir -p "/home/$DEPLOY_USER/.ssh"
echo "$DEPLOY_PUBKEY" > "/home/$DEPLOY_USER/.ssh/authorized_keys"
chmod 700 "/home/$DEPLOY_USER/.ssh"
chmod 600 "/home/$DEPLOY_USER/.ssh/authorized_keys"
chown -R "$DEPLOY_USER:$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh"

echo "==> Docker"
curl -fsSL https://get.docker.com | sh
usermod -aG docker "$DEPLOY_USER"

# This list isn't a limit. The docker group and systemctl each make deploy effectively
# root, so treat its SSH key as a root key.
echo "==> Sudo for the deploy user"
cat > /etc/sudoers.d/deploy <<SUDOERS
$DEPLOY_USER ALL=(root) NOPASSWD: /usr/bin/systemctl, /usr/bin/journalctl, /usr/bin/apt-get update, /usr/bin/apt-get upgrade -y
SUDOERS
chmod 440 /etc/sudoers.d/deploy

# 00, not 99: sshd uses the first value it finds, so 50-cloud-init.conf would otherwise win.
echo "==> SSH lockdown"
cat > /etc/ssh/sshd_config.d/00-hardening.conf <<'SSHD'
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
X11Forwarding no
MaxAuthTries 3
AllowUsers deploy
SSHD
systemctl restart ssh
sshd -T | grep -Ei '^(permitrootlogin|passwordauthentication) '

# ufw doesn't cover Docker's published ports: Docker writes its own rules around it. The
# DigitalOcean Cloud Firewall is what protects 80 and 443.
echo "==> Firewall"
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable

echo "==> fail2ban"
cat > /etc/fail2ban/jail.local <<'JAIL'
[sshd]
enabled = true
maxretry = 3
bantime = 1h
JAIL
systemctl enable --now fail2ban

echo "==> Done. Test 'ssh deploy@<ip>' in a NEW terminal before closing this one."
