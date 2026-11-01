# Sourced by backup.sh and restore.sh, from the app directory, so the two can't disagree
# about how the encrypted copy is reached.

# By digest as well as version, because this image is handed the bucket key and passphrase.
RCLONE_IMAGE="rclone/rclone:1.75.2@sha256:2687085f718d3c628f7fdfb77c52a1d344332aed543110bb88088f2c70d43eb5"

# Reads one setting without running .env as shell.
env_value() {
  [ -f .env ] || return 0
  sed -n "s/^$1=//p" .env | tail -n 1
}

# From stdin, so the passphrase is never on a command line. Crypt only takes obscured values.
rclone_obscure() {
  printf '%s\n' "$1" | docker run --rm -i "$RCLONE_IMAGE" obscure -
}

# Writes the settings for the `backupcrypt:` remote. The caller makes the file with umask 077
# and passes it with --env-file, because `-e KEY=value` would show in `ps`.
write_rclone_env() {
  local file="$1" remote password password2 obscured obscured2
  remote="$(env_value BACKUP_REMOTE)"
  password="$(env_value BACKUP_CRYPT_PASSWORD)"
  password2="$(env_value BACKUP_CRYPT_PASSWORD2)"
  if [ -z "$remote" ] || [ -z "$password" ] || [ -z "$password2" ]; then
    echo "!!! BACKUP_REMOTE needs BACKUP_CRYPT_PASSWORD and BACKUP_CRYPT_PASSWORD2 in .env" >&2
    return 1
  fi
  obscured="$(rclone_obscure "$password")" || return 1
  obscured2="$(rclone_obscure "$password2")" || return 1
  {
    grep '^RCLONE_CONFIG_BACKUPSTORE_' .env || true
    echo "RCLONE_CONFIG_BACKUPCRYPT_TYPE=crypt"
    echo "RCLONE_CONFIG_BACKUPCRYPT_REMOTE=$remote"
    echo "RCLONE_CONFIG_BACKUPCRYPT_PASSWORD=$obscured"
    echo "RCLONE_CONFIG_BACKUPCRYPT_PASSWORD2=$obscured2"
    # Spelled out, so a new rclone default can't leave old dumps unreadable.
    echo "RCLONE_CONFIG_BACKUPCRYPT_FILENAME_ENCRYPTION=standard"
    echo "RCLONE_CONFIG_BACKUPCRYPT_DIRECTORY_NAME_ENCRYPTION=true"
  } > "$file"
}
