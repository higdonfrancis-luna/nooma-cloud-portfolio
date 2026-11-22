#!/usr/bin/env bash
# Joins one folder's slides and narration into an MP4. Usage: ./make_video.sh aws|lunaphone out.mp4
set -euo pipefail
cd "$(dirname "$0")/$1"; rm -f clips/*.mp4 list.txt; mkdir -p clips
for a in audio/*.mp3; do b=$(basename "$a" .mp3)
  ffmpeg -v error -y -loop 1 -framerate 30 -i "slides/$b.png" -i "$a" \
    -filter_complex "[1:a]adelay=500|500,apad=pad_dur=0.9[a]" -map 0:v -map "[a]" \
    -c:v libx264 -tune stillimage -preset veryfast -crf 20 -pix_fmt yuv420p -r 30 \
    -c:a aac -b:a 160k -ar 48000 -shortest "clips/$b.mp4"
  echo "file 'clips/$b.mp4'" >> list.txt
done
ffmpeg -v error -y -f concat -safe 0 -i list.txt -c copy "$2"
