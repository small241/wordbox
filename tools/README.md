# Nagrania lektora (ElevenLabs)

Aplikacja czyta angielskie słówka i zdania głosem przeglądarki. Jeśli w katalogu `audio/` są nagrania
z ElevenLabs, odtwarza je zamiast tego (lektor brzmi naturalniej i tak samo na każdym urządzeniu).
Brak nagrania dla jakiegoś tekstu, brak internetu albo wyłączona opcja w Ustawieniach = głos przeglądarki.

Klucz API **nie trafia do aplikacji ani do repozytorium**. Nagrania powstają raz, na Twoim komputerze,
a do strony trafiają tylko gotowe pliki `.mp3`.

## Jednorazowa konfiguracja

1. Wybierz głos w ElevenLabs i skopiuj jego identyfikator (Voice ID).
2. Utwórz plik `tools/.env` (jest ignorowany przez Git) z trzema liniami:

       ELEVENLABS_API_KEY=twój_klucz
       ELEVENLABS_VOICE_ID=identyfikator_głosu
       ELEVENLABS_MODEL=eleven_flash_v2_5

   Ostatnia linia jest opcjonalna (`eleven_multilingual_v2` brzmi pełniej, ale zużywa więcej znaków).

## Użycie

    node tools/gen-audio.cjs --dry   # ile tekstów i znaków do nagrania (nic nie wysyła)
    node tools/gen-audio.cjs         # nagrywa brakujące teksty do audio/
    git add audio && git commit -m "Nagrania lektora" && git push

Skrypt nie nagrywa drugi raz tego, co już ma, więc po dopisaniu słówek wystarczy uruchomić go ponownie —
zapłacisz tylko za nowe teksty. Gdy skończy się limit znaków w koncie, skrypt zatrzymuje się, zapisuje
to, co zdążył nagrać, i przy następnym uruchomieniu dokańcza resztę.

## Czego to nie obejmuje

- Słówek, które dzieci dopisują same w Ustawieniach (są tylko w ich przeglądarce) — czyta je głos przeglądarki.
- Wersji w artefakcie Claude i plików otwieranych lokalnie (`file://`) — tam sieć jest zablokowana.
