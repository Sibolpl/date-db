# Date Booking — Cloudflare Pages + D1

Aplikacja zawiera publiczny formularz rezerwacji oraz prywatny panel administratora.
Baza D1 przechowuje profile, rezerwacje i blokady. Discord jest używany wyłącznie do powiadomień.

## Wdrożenie

### 1. Utwórz bazę D1
Cloudflare Dashboard → Workers & Pages → D1 SQL Database → Create database.
Nazwa: `date-booking-db`.
Skopiuj Database ID.

### 2. Uzupełnij wrangler.toml
Wstaw skopiowany identyfikator zamiast `UZUPELNIJ_ID_BAZY_D1`.
Nie zmieniaj nazwy bindingu `DB`.

### 3. Utwórz tabelki
W D1 → baza `date-booking-db` → Console.
Wklej całą zawartość `migrations/0001_initial.sql` i uruchom.

### 4. Wgraj pliki do GitHub
Wypakuj ZIP i umieść całą zawartość w repozytorium podłączonym do Cloudflare Pages.
Ważne: foldery `functions`, `migrations`, `public` i `wrangler.toml` muszą być w katalogu głównym repozytorium.

### 5. Ustaw Pages
Workers & Pages → wybierz projekt Pages → Settings → Builds & deployments:
- Framework preset: None
- Build command: pozostaw puste
- Build output directory: `public`
- Root directory: `/`

Połącz repozytorium z Pages i uruchom deploy.

### 6. Dodaj binding D1 do Pages
Pages → Settings → Functions → D1 database bindings → Add binding:
- Variable name: `DB`
- D1 database: `date-booking-db`

Zapisz i wykonaj nowy deploy. (Binding musi być dostępny dla środowiska produkcyjnego.)

### 7. Dodaj sekrety
Pages → Settings → Variables and Secrets → Production:
- `ADMIN_PASSWORD` — silne, unikalne hasło administratora.
- `DISCORD_WEBHOOK` — adres webhooka Discord (typ Secret).

Zapisz i wykonaj nowy deploy.

### 8. Otwórz stronę
Publiczna: `https://TWOJ-ADRES.pages.dev/`
Panel: `https://TWOJ-ADRES.pages.dev/admin`

Zaloguj się hasłem z `ADMIN_PASSWORD`, dodaj profile i gotowe.

## Lokalny podgląd (opcjonalnie)
Wymaga Node.js i Wrangler:
```bash
npm install -D wrangler
npx wrangler pages dev public --d1=DB
```
Do lokalnego uruchomienia trzeba skonfigurować lokalny binding D1 i wykonać migrację. Najłatwiej testować po wdrożeniu na Cloudflare.

## Funkcje
- Publiczne rezerwacje z wyborem profilu, dnia i godziny.
- Sloty co 30 minut, od 09:00 do 19:30.
- Blokady globalne lub dla konkretnego profilu.
- Panel administratora z widokiem miesiąc/tydzień/dzień.
- Filtrowanie kalendarza po profilu.
- Anulowanie rezerwacji i zwalnianie terminu.
- Powiadomienia Discord o rezerwacjach i anulowaniach.

## Ważne uwagi bezpieczeństwa
- Nie umieszczaj `ADMIN_PASSWORD` ani webhooka w plikach `public/`.
- Zmień hasło, jeśli kiedykolwiek ujawnisz je publicznie.
- Panel korzysta z sesji w ciasteczku HttpOnly/Secure/SameSite i wygasa po 8 godzinach.
- W produkcji warto dodać Cloudflare Turnstile / rate limiting dla publicznego formularza, aby ograniczyć spam.
- Nie udostępniaj nikomu adresu webhooka Discord.
