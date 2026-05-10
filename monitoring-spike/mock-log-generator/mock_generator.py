import json
import os
import random
import threading
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, HTTPServer

LOKI_URL = os.environ.get("LOKI_URL", "http://localhost:3100/loki/api/v1/push")
METRICS_PORT = int(os.environ.get("METRICS_PORT", "9100"))

TASK_AVERAGES = {
    "epoch": 248.0,
    "fetch validators": 181.2,
    "process slots": 88.1,
    "slot": 2.9,
    "process attestations": 0.74,
    "save attestations": 0.69,
    "update committee chunk": 0.51,
    "fetch block rewards": 0.21,
}


def format_seconds(value):
    if value >= 60:
        minutes = value / 60
        return f"{minutes:.2f}".rstrip("0").rstrip(".") + "m"
    return f"{value:.2f}".rstrip("0").rstrip(".") + "s"


def add_table_fields(row):
    avg = TASK_AVERAGES.get(row["task"], 1.0)
    delta = row["duration"] - avg
    delta_prefix = "+" if delta >= 0 else ""

    return {
        **row,
        "statusIcon": "●" if row["status"] == "running" else "✓",
        "taskPath": row["taskPath"],
        "totalDisplay": format_seconds(row["duration"]),
        "avgDisplay": format_seconds(avg),
        "deltaDisplay": f"{delta_prefix}{format_seconds(delta)}",
    }


RUNNING_ROWS = [
    {
        "epoch": "446403",
        "slot": "",
        "task": "epoch",
        "taskPath": "epoch 446403",
        "parentTask": "",
        "status": "running",
        "duration": 228.4,
    },
    {
        "epoch": "446403",
        "slot": "",
        "task": "fetch validators",
        "taskPath": "epoch 446403 / fetch validators",
        "parentTask": "epoch",
        "status": "running",
        "duration": 228.4,
    },
    {
        "epoch": "446403",
        "slot": "",
        "task": "process slots",
        "taskPath": "epoch 446403 / process slots",
        "parentTask": "epoch",
        "status": "done",
        "duration": 94.87,
    },
    {
        "epoch": "446403",
        "slot": "14284929",
        "task": "slot",
        "taskPath": "epoch 446403 / slot 14284929",
        "parentTask": "process slots",
        "status": "running",
        "duration": 2.1,
    },
    {
        "epoch": "446403",
        "slot": "14284929",
        "task": "process attestations",
        "taskPath": "epoch 446403 / slot 14284929 / process attestations",
        "parentTask": "slot",
        "status": "running",
        "duration": 1.8,
    },
    {
        "epoch": "446403",
        "slot": "14284929",
        "task": "save attestations",
        "taskPath": "epoch 446403 / slot 14284929 / save attestations",
        "parentTask": "process attestations",
        "status": "running",
        "duration": 1.5,
    },
]

COMPLETED_ROWS = [
    {
        "epoch": "446403",
        "slot": "14284928",
        "task": "slot",
        "taskPath": "epoch 446403 / slot 14284928",
        "parentTask": "process slots",
        "status": "done",
        "duration": 2.7,
    },
    {
        "epoch": "446403",
        "slot": "14284927",
        "task": "slot",
        "taskPath": "epoch 446403 / slot 14284927",
        "parentTask": "process slots",
        "status": "done",
        "duration": 2.8,
    },
    {
        "epoch": "446403",
        "slot": "14284927",
        "task": "process attestations",
        "taskPath": "epoch 446403 / slot 14284927 / process attestations",
        "parentTask": "slot",
        "status": "done",
        "duration": 2.55,
    },
    {
        "epoch": "446403",
        "slot": "14284927",
        "task": "save attestations",
        "taskPath": "epoch 446403 / slot 14284927 / save attestations",
        "parentTask": "process attestations",
        "status": "done",
        "duration": 2.34,
    },
    {
        "epoch": "446403",
        "slot": "14284927",
        "task": "update committee chunk",
        "taskPath": "epoch 446403 / slot 14284927 / update committee chunk 1/5 rows=7000",
        "parentTask": "save attestations",
        "status": "done",
        "duration": 0.75,
    },
]


class MetricsHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path != "/metrics":
            self.send_response(404)
            self.end_headers()
            return

        lines = [
            "# HELP indexer_mock_task_duration_seconds Mock task duration histogram.",
            "# TYPE indexer_mock_task_duration_seconds histogram",
        ]

        for task, avg in TASK_AVERAGES.items():
            label = task.replace('"', '\\"')
            lines.append(f'indexer_mock_task_average_seconds{{task="{label}"}} {avg}')

        body = "\n".join(lines) + "\n"
        self.send_response(200)
        self.send_header("Content-Type", "text/plain; version=0.0.4")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body.encode("utf-8"))

    def log_message(self, format, *args):
        return


def push_rows(rows):
    now = time.time_ns()
    streams = []

    for index, row in enumerate(rows):
        started = time.strftime("%H:%M:%S", time.localtime(time.time() - len(rows) + index))
        table_row = add_table_fields(row)
        event = {
            **table_row,
            "started": started,
            "avg": TASK_AVERAGES.get(row["task"], 1.0),
            "sequence": index,
            "reportedAt": int(time.time()),
        }

        stream = {
            "stream": {
                "app": "indexer-mock",
                "epoch": row["epoch"],
                "slot": row["slot"] or "none",
                "task": row["task"],
                "status": row["status"],
            },
            "values": [[str(now + index), json.dumps(event)]],
        }
        streams.append(stream)

    payload = json.dumps({"streams": streams}).encode("utf-8")
    request = urllib.request.Request(
        LOKI_URL,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    urllib.request.urlopen(request, timeout=5).read()


def run_log_loop():
    while True:
        rows = RUNNING_ROWS + random.sample(COMPLETED_ROWS, k=len(COMPLETED_ROWS))
        try:
            push_rows(rows)
        except Exception as exc:
            print(f"failed to push logs: {exc}", flush=True)
        time.sleep(3)


def run_metrics_server():
    server = HTTPServer(("0.0.0.0", METRICS_PORT), MetricsHandler)
    server.serve_forever()


if __name__ == "__main__":
    threading.Thread(target=run_metrics_server, daemon=True).start()
    run_log_loop()
