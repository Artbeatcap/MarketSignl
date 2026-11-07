# Personal transcript worker. Do not use this image for the ChartSignl n8n service.
# yt-dlp is pinned. The n8n base tag is pinned so a rebuild does not float.
# docker.io, not docker.n8n.io: that registry returns 429 from the VPS.
# n8n 2.46.6 is a hardened Alpine image with no apk and no Python, so yt-dlp
# is built in a normal Alpine stage and copied in with its own libraries.

FROM alpine:3.24 AS ytdlp
RUN apk add --no-cache python3 py3-pip ca-certificates deno \
 && pip3 install --break-system-packages --no-cache-dir 'yt-dlp==2026.10.26' \
 && mkdir -p /opt/ytdlp/bin /opt/ytdlp/lib \
 && cp -aL /usr/bin/python3.14 /opt/ytdlp/bin/python3.14 \
 && cp -aL /usr/lib/libpython3.14.so.1.0 /opt/ytdlp/lib/libpython3.14.so.1.0 \
 && cp -a /usr/lib/python3.14 /opt/ytdlp/lib/python3.14 \
 && cp -aL \
      /usr/lib/libbz2.so.1 \
      /usr/lib/libcrypto.so.3 \
      /usr/lib/libexpat.so.1 \
      /usr/lib/libffi.so.8 \
      /usr/lib/libgdbm.so.6 \
      /usr/lib/libgdbm_compat.so.4 \
      /usr/lib/liblzma.so.5 \
      /usr/lib/libmpdec.so.4 \
      /usr/lib/libncursesw.so.6 \
      /usr/lib/libpanelw.so.6 \
      /usr/lib/libreadline.so.8 \
      /usr/lib/libsqlite3.so.0 \
      /usr/lib/libssl.so.3 \
      /usr/lib/libz.so.1 \
      /opt/ytdlp/lib/ \
 && cp -a /usr/bin/yt-dlp /opt/ytdlp/bin/yt-dlp.py \
 && printf '%s\n' \
      '#!/bin/sh' \
      'export LD_LIBRARY_PATH=/opt/ytdlp/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}' \
      'export PYTHONHOME=/opt/ytdlp' \
      'exec /opt/ytdlp/bin/python3.14 /opt/ytdlp/bin/yt-dlp.py "$@"' \
      > /opt/ytdlp/bin/yt-dlp \
 && chmod 755 /opt/ytdlp/bin/yt-dlp /opt/ytdlp/bin/python3.14 \
 && LD_LIBRARY_PATH=/opt/ytdlp/lib PYTHONHOME=/opt/ytdlp \
      /opt/ytdlp/bin/python3.14 /opt/ytdlp/bin/yt-dlp.py --version | grep -qx '2026.10.26' \
 && mkdir -p /opt/deno/bin /opt/deno/lib \
 && cp -aL "$(readlink -f "$(command -v deno)")" /opt/deno/bin/deno \
 && cp -aL /usr/lib/libicu*.so.* /usr/lib/libsimdutf.so.* /usr/lib/libstdc++.so.* /usr/lib/libgcc_s.so.* /opt/deno/lib/ \
 && ldd /opt/deno/bin/deno | awk '/=>/ { print $3 }' | while read -r lib; do \
      [ -f "$lib" ] && cp -aL "$lib" /opt/deno/lib/; \
    done \
 && printf '%s\n' \
      '#!/bin/sh' \
      'export LD_LIBRARY_PATH=/opt/deno/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}' \
      'exec /opt/deno/bin/deno "$@"' \
      > /opt/deno/bin/deno-run \
 && chmod 755 /opt/deno/bin/deno /opt/deno/bin/deno-run \
 && LD_LIBRARY_PATH=/opt/deno/lib /opt/deno/bin/deno --version

FROM docker.io/n8nio/n8n:2.46.6

USER root
COPY --from=ytdlp /opt/ytdlp /opt/ytdlp
COPY --from=ytdlp /opt/deno /opt/deno
RUN ln -sf /opt/ytdlp/bin/yt-dlp /usr/local/bin/yt-dlp \
 && ln -sf /opt/deno/bin/deno-run /usr/local/bin/deno \
 && yt-dlp --version | grep -qx '2026.10.26' \
 && deno --version

COPY transcripts /opt/transcripts
RUN chown -R node:node /opt/transcripts /opt/ytdlp /opt/deno
USER node
