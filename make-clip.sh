#!/usr/bin/env bash
#
# Генератор вертикальных клипов 1080x1920 для VK Клипов из обложки и трека.
# Не требует видеоредактора — всё делает ffmpeg.
#
#   ./make-clip.sh -i обложка.jpg -a трек.wav -s 45 -d 15 -m wave -o clip01.mp4
#   ./make-clip.sh -i обложка.jpg -a трек.wav -s 62 -d 12 -m none -t "строка|вторая" -o clip02.mp4
#   ./make-clip.sh -i обложка.jpg -a трек.wav -s 20 -d 18 -m spectrum -t "строка" -o clip03.mp4
#
# Основа кадра всегда одна: медленный наезд по картинке.
# Поверх неё независимо добавляются элементы:
#
#   -m  нижняя полоса:  none (нет) | wave (волна) | spectrum (спектр)
#   -t  текст по центру; переносы строк через | . При наличии текста
#       картинка автоматически затемняется, чтобы буквы читались.
#
# Полосу и текст можно сочетать: -m wave -t "строка" даст и волну, и текст.
#
# -s  секунда трека, с которой начинается фрагмент (берите хук, а не интро)
# -d  длительность, секунд (10–20 оптимально)
# -f  файл шрифта (по умолчанию DejaVu Sans Bold)

set -euo pipefail

IMG="" AUD="" START=0 DUR=15 MODE=none TEXT="" OUT=""
FONT="${CLIP_FONT:-/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf}"

while getopts "i:a:s:d:m:t:o:f:h" opt; do
  case $opt in
    i) IMG=$OPTARG ;; a) AUD=$OPTARG ;; s) START=$OPTARG ;; d) DUR=$OPTARG ;;
    m) MODE=$OPTARG ;; t) TEXT=$OPTARG ;; o) OUT=$OPTARG ;; f) FONT=$OPTARG ;;
    h) sed -n '2,26p' "$0" | sed 's/^# \?//'; exit 0 ;;
    *) exit 1 ;;
  esac
done

# совместимость со старыми командами
[[ $MODE == still ]] && MODE=none
[[ $MODE == text  ]] && MODE=none

[[ -z $IMG || -z $AUD || -z $OUT ]] && { echo "нужны -i, -a и -o. Справка: $0 -h" >&2; exit 1; }
[[ -f $IMG ]] || { echo "нет файла: $IMG" >&2; exit 1; }
[[ -f $AUD ]] || { echo "нет файла: $AUD" >&2; exit 1; }
[[ $MODE =~ ^(none|wave|spectrum)$ ]] || { echo "-m: none, wave или spectrum" >&2; exit 1; }
[[ -n $TEXT && ! -f $FONT ]] && { echo "шрифт не найден: $FONT (задайте -f)" >&2; exit 1; }

FRAMES=$(python3 -c "print(int($DUR*30))")
# медленный наезд по кадру — оживляет статичную картинку
KEN="scale=1300:2300:force_original_aspect_ratio=increase,crop=1300:2300,\
zoompan=z='min(zoom+0.0004,1.2)':d=$FRAMES:s=1080x1920:fps=30"

# --- собираем цепочку: основа -> [затемнение] -> [полоса] -> [текст] ---
V="[0:v]${KEN}"
[[ -n $TEXT ]] && V="${V},drawbox=x=0:y=0:w=1080:h=1920:color=black@0.45:t=fill"
V="${V},format=yuv420p[bg]"

case $MODE in
  wave)
    FC="${V};[1:a]showwaves=s=1080x240:mode=cline:colors=0xffffff@0.85:rate=30,format=yuva420p[s];\
[bg][s]overlay=0:1450:shortest=1" ;;
  spectrum)
    FC="${V};[1:a]showfreqs=s=1080x260:mode=bar:ascale=log:colors=0xffffff@0.7,format=yuva420p[s];\
[bg][s]overlay=0:1430:shortest=1" ;;
  none)
    FC="${V};[bg]null" ;;
esac

if [[ -n $TEXT ]]; then
  ESC=$(printf '%s' "$TEXT" | sed "s/|/\\\\n/g; s/'/\\\\'/g; s/:/\\\\:/g")
  FC="${FC},drawtext=fontfile='${FONT}':text='${ESC}':fontcolor=white:fontsize=64:\
line_spacing=18:x=(w-text_w)/2:y=(h-text_h)/2:alpha='min(1,t/1.2)'[v]"
else
  FC="${FC}[v]"
fi

TMP=$(mktemp --suffix=.mp4)
trap 'rm -f "$TMP"' EXIT

ffmpeg -v error -loop 1 -i "$IMG" -ss "$START" -t "$DUR" -i "$AUD" \
  -filter_complex "$FC" -map "[v]" -map 1:a \
  -c:v libx264 -preset medium -crf 20 -r 30 -g 30 -pix_fmt yuv420p \
  -c:a aac -b:a 192k -movflags +faststart -t "$DUR" -y "$TMP"

# пишем во временный файл и переименовываем — иначе файловый менеджер
# попытается построить миниатюру на недописанном файле и закэширует отказ
mv "$TMP" "$OUT"
trap - EXIT

echo "готово: $OUT"
ffprobe -v error -show_entries format=duration -show_entries stream=width,height,pix_fmt \
  -of default=noprint_wrappers=1 "$OUT" | sed 's/^/  /'
