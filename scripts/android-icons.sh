#!/bin/sh
# Erzeugt App-Symbol und Startbild der Android-App aus dem Logo (Pin mit Haken, wie public/favicon.svg).
# Aufruf im Projektordner: sh scripts/android-icons.sh   (braucht ImageMagick: magick)
#
# - Adaptives Symbol (ab Android 8): Vordergrund = weißer Pin auf durchsichtigem Grund, Hintergrund
#   Indigo (values/ic_launcher_background.xml). Je nach Launcher wird es rund, abgerundet usw.
#   beschnitten. Sicher sichtbar ist nur ein Kreis von 66 der 108 Einheiten, der Pin bleibt darin.
# - Klassische Symbole (ic_launcher, ic_launcher_round) für ältere Android-Versionen.
# - Startbild (splash.png) in allen vorhandenen Größen: weiß, Logo in der Mitte.
set -eu
RES=android/app/src/main/res
TMP=$(mktemp -d)
trap 'rm -r "$TMP"' EXIT

BRAND='#3a3591'
# Der Pin mit Haken in einem Feld von 100 x 100 Einheiten, Mitte bei 50/53
PIN='<ellipse cx="50" cy="88.5" rx="11" ry="2.6" fill="#8d86f0"/><path d="M50 15c-14.9 0-27 11.6-27 26.4C23 61 50 85 50 85s27-24 27-43.6C77 26.6 64.9 15 50 15z" fill="#fff"/><path d="M37.5 41.5l8.5 8.5 16.5-17" fill="none" stroke="#3a3591" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>'

# $1 = Datei, $2 = Höhe des Pins in Prozent der Fläche, $3 = Hintergrund (none | square | circle)
pin_svg() {
  scale=$(awk "BEGIN { print 1024 * $2 / 100 / 76 }") # der Pin ist 76 Einheiten hoch (15 bis 91)
  offset_x=$(awk "BEGIN { print 512 - 50 * $scale }")
  offset_y=$(awk "BEGIN { print 512 - 53 * $scale }")
  case $3 in
    square) bg="<rect width=\"1024\" height=\"1024\" fill=\"$BRAND\"/>" ;;
    circle) bg="<circle cx=\"512\" cy=\"512\" r=\"512\" fill=\"$BRAND\"/>" ;;
    *) bg='' ;;
  esac
  printf '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">%s<g transform="translate(%s %s) scale(%s)">%s</g></svg>' \
    "$bg" "$offset_x" "$offset_y" "$scale" "$PIN" > "$1"
}

pin_svg "$TMP/vordergrund.svg" 46 none # bleibt im sicheren Kreis
pin_svg "$TMP/eckig.svg" 56 square     # wie die Web-Icons in public/icons
pin_svg "$TMP/rund.svg" 50 circle

render() { magick -background none -density 300 "$1" -resize "$2x$2" "$3"; }

for pair in mdpi:48 hdpi:72 xhdpi:96 xxhdpi:144 xxxhdpi:192; do
  dpi=${pair%%:*}
  size=${pair#*:}
  dir="$RES/mipmap-$dpi"
  render "$TMP/vordergrund.svg" $((size * 9 / 4)) "$dir/ic_launcher_foreground.png" # 108 dp statt 48 dp
  render "$TMP/eckig.svg" "$size" "$dir/ic_launcher.png"
  render "$TMP/rund.svg" "$size" "$dir/ic_launcher_round.png"
done

# Startbild: jede vorhandene splash.png in ihrer Größe neu, Logo (public/favicon.svg) = 24 % der kürzeren Seite
render public/favicon.svg 1024 "$TMP/logo.png"
for file in "$RES"/drawable*/splash.png; do
  size=$(magick identify -format '%w %h' "$file")
  w=${size% *}
  h=${size#* }
  short=$((w < h ? w : h))
  magick -size "${w}x${h}" xc:white \( "$TMP/logo.png" -resize "$((short * 24 / 100))x" \) -gravity center -composite "$file"
done

echo "App-Symbole und Startbilder in $RES erneuert."
