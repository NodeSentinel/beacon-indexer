# Indexer Monitoring Spike

Disposable Grafana/Loki/Prometheus spike for validating an indexer task view with mock data.

## Run

```sh
docker compose up -d --build
```

Grafana opens at `http://localhost:3300/d/indexer-monitoring-spike/indexer-monitoring-spike`.

Credentials are `admin` / `admin`, and anonymous admin access is enabled for the spike.
