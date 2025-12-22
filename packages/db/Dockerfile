FROM postgres:16

# Install pg_repack extension
RUN apt-get update && \
    apt-get install -y postgresql-16-repack && \
    rm -rf /var/lib/apt/lists/*

