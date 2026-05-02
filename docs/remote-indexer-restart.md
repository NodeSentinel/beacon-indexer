# Remote Indexer Restart

## Goal

Restart the `indexer` service from your phone without exposing Docker or an admin panel to the internet.

## Step 1: Install Tailscale

On the VPS:

```sh
# Install Tailscale on the VPS host.
curl -fsSL https://tailscale.com/install.sh | sh

# Connect the VPS to your Tailscale account.
sudo tailscale up
```

On your phone:

```text
# Install the Tailscale app and log into the same account.
iPhone: App Store -> Tailscale
Android: Google Play -> Tailscale
```

## Step 2: Enable Tailscale SSH

In the Tailscale admin panel:

```text
# Enable SSH access managed by Tailscale.
https://login.tailscale.com/admin/settings/ssh
```

## Step 3: Create The Restart Command On The VPS

Run from the root of the repo

```sh

# Make the repo script executable.
chmod +x "infra/docker/bin/restart-indexer"

# Create a short global command.
sudo ln -sf "$(pwd)/infra/docker/bin/restart-indexer" /usr/local/bin/restart-indexer
```

Test it on the VPS:

```sh
# Restart only the indexer service.
sudo restart-indexer
```

## Step 4: Create A Restricted User

On the VPS:

```sh
# Create a user used only for remote operations.
# This avoids the interactive password prompt.
sudo adduser --disabled-password --gecos "" ops
```

Allow only the restart command:

```sh
# Open a safe sudoers editor.
sudo visudo -f /etc/sudoers.d/nodesentinel-indexer-restart
```

Paste:

```sudoers
# Let ops restart only the indexer command without a password.
ops ALL=(root) NOPASSWD: /usr/local/bin/restart-indexer
```

## Step 5: Restart From Your Phone

Find the VPS Tailscale name or IP:

```sh
# Show the VPS name and Tailscale IP.
tailscale status
```

Use either value in the SSH command:

```sh
# Replace this with the VPS name or Tailscale IP.
ssh ops@<VPS_TAILSCALE_NAME> 'sudo /usr/local/bin/restart-indexer'
```

## Step 6: Add A One-Tap iPhone Shortcut

On the iPhone:

1. Open **Shortcuts**.
2. Tap `+`.
3. Search for **Run Script over SSH**.
4. Set **Host** to the VPS Tailscale name or IP.
5. Set **User** to `ops`.
6. Set **Script** to:

```sh
# Restart the indexer service.
sudo /usr/local/bin/restart-indexer
```

Then:

1. Name it `Restart Indexer`.
2. Tap the share button.
3. Tap **Add to Home Screen**.

After that, restarting the indexer is one tap from the iPhone home screen.

## Notes

- Install Tailscale on the VPS host, not as a Docker container.
- Do not expose Docker, Portainer, or a custom webhook publicly.
- If you move VPS, repeat steps 1, 3, and 4 with the new repo path.
