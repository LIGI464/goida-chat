# VPS deployment checklist

This project is designed to move to a VPS with minimal changes after the local MVP works.

## 1. VPS baseline

Recommended starting server:

- Ubuntu 24.04 LTS
- 2 vCPU minimum, 4 vCPU preferred
- 4 GB RAM minimum, 8 GB preferred for larger video rooms
- 40 GB SSD minimum
- public IPv4

For a 2 vCPU / 4 GB VPS, add a 2 GB swap file before building containers:

```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

Install packages:

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y git curl ufw ca-certificates
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"
```

Log out and back in after adding the Docker group.

## 2. DNS

Point these records to the VPS IP:

```text
app.example.com      A  <VPS_IP>
api.example.com      A  <VPS_IP>
livekit.example.com  A  <VPS_IP>
```

## 3. Firewall

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 443/udp
sudo ufw allow 7881/tcp
sudo ufw allow 59000:59100/udp
sudo ufw enable
```

For larger calls, increase the LiveKit UDP range in both `services/livekit/livekit.yaml` and `docker-compose.yml`.

## 4. First deploy

```bash
git clone https://github.com/LIGI464/goida-chat.git
cd goida-chat
cp .env.example .env
```

Edit `.env`:

```env
NODE_ENV=production

APP_URL=https://app.example.com
API_URL=https://api.example.com
LIVEKIT_URL=wss://livekit.example.com

APP_SITE=app.example.com
API_SITE=api.example.com
LIVEKIT_SITE=livekit.example.com

BETTER_AUTH_URL=https://api.example.com

POSTGRES_PASSWORD=<strong-password>
DATABASE_URL=postgresql://goida:<same-password>@postgres:5432/goida_chat?schema=public
COOKIE_SECRET=<openssl-rand-base64-48>
BETTER_AUTH_SECRET=<openssl-rand-base64-48>
LIVEKIT_API_KEY=<livekit-key>
LIVEKIT_API_SECRET=<livekit-secret>
```

Generate secrets:

```bash
openssl rand -base64 48
```

Build sequentially on a 4 GB VPS to reduce peak memory usage, then start the stack:

```bash
docker compose build backend
docker compose build frontend
docker compose up -d
docker compose exec backend npx prisma migrate deploy --schema services/api/prisma/schema.prisma
docker compose ps
```

## 5. Smoke tests

Open:

- `https://app.example.com`
- `https://api.example.com/health`

Test checklist:

- register two users;
- search user by username;
- create direct chat;
- send message and see realtime delivery;
- enter voice in one browser;
- enter the same voice room in another browser;
- leave from one user and confirm the other remains connected.

## 6. Database backup

Manual backup:

```bash
mkdir -p backups
docker compose exec -T postgres pg_dump -U goida -d goida_chat | gzip > "backups/goida-chat-$(date +%F-%H%M).sql.gz"
```

Restore example:

```bash
gunzip -c backups/goida-chat-YYYY-MM-DD-HHMM.sql.gz | docker compose exec -T postgres psql -U goida -d goida_chat
```
