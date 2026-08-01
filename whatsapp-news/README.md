# WhatsApp Channel — Daily News Digest

A small, dependency-free tool that builds a **formal-English, WhatsApp-ready
daily briefing** across three tracks:

- 🤖 **Artificial Intelligence**
- 🎓 **Higher Education & Accreditation** (NAAC · NBA · UGC · AICTE · NEP 2020)
- 💡 **Ed-Tech & Research**

You run one command each morning; it produces a clean post that you paste into
your WhatsApp Channel in a couple of taps.

---

## Why you paste it yourself (an honest note)

WhatsApp **Channels** are a broadcast feature managed **inside the WhatsApp
app**. WhatsApp does **not** provide an official API to post to a Channel — the
WhatsApp Business/Cloud API is only for one-to-one customer messaging. Tools
that claim to auto-post to Channels rely on unofficial automation that can get
your number **banned**.

So this tool automates the genuinely time-consuming 95% — **finding, filtering,
de-duplicating and formatting** the news — and leaves you the safe 30-second
step of pasting it into your Channel.

---

## Part 1 — Create your WhatsApp Channel (one time, ~3 minutes)

1. Open **WhatsApp** → **Updates** tab (bottom of the screen).
2. Tap the **＋** next to *Channels* → **Create channel** → **Continue**.
3. Enter a **name** (e.g. *"AI & Higher-Ed Daily"*). You can change it later.
4. Add a **description** and a **profile photo** (optional but recommended).
5. Tap **Create channel**. Done — share the channel link to grow followers.

> Tip: A consistent posting time (e.g. 8:30 AM daily) trains your audience to
> expect the briefing and improves retention.

---

## Part 2 — Generate the daily digest

### Requirements
- **Python 3.8+** (standard library only — nothing to `pip install`).
- Internet access on the machine you run it from.

### Run it

```bash
cd whatsapp-news
python3 generate_digest.py
```

This prints the post and saves it to `output/digest-YYYY-MM-DD.txt`.
Open that file, **select all, copy, and paste** into your Channel.

### Useful options

| Command | What it does |
|---|---|
| `python3 generate_digest.py` | Today's digest (last 36h), max 6 items/track |
| `python3 generate_digest.py --hours 24` | Only items from the last 24 hours |
| `python3 generate_digest.py --max 4` | Cap each track at 4 items (shorter post) |
| `python3 generate_digest.py --print-only` | Print to screen only, don't save a file |
| `python3 generate_digest.py --self-test` | Offline check that parsing/formatting work |

A sample output is included at `output/digest-2026-08-01.txt` so you can see the
exact format before running anything.

---

## Part 3 — Customise the content

Open `generate_digest.py` and edit the **`TRACKS`** list near the top. Each
track is a **Google News search**, so you can tune it with normal search
operators:

```python
{
    "key": "highered",
    "title": "Higher Education & Accreditation",
    "emoji": "\U0001F393",
    "query": 'NAAC OR NBA accreditation OR UGC OR AICTE OR "NEP 2020" India',
},
```

- Use `OR` to widen, quotes `"..."` for exact phrases, `-word` to exclude.
- Add or remove whole tracks freely — the formatter adapts.
- Change `GNEWS_HL` / `GNEWS_GL` / `GNEWS_CEID` to target a different
  region/language (defaults are India / English).

---

## Part 4 — Run it automatically each morning (optional)

You still paste the result, but the file is ready and waiting for you.

### Linux / macOS (cron)
Run `crontab -e` and add (adjust the path; this runs 08:15 daily):

```cron
15 8 * * *  cd /full/path/to/whatsapp-news && /usr/bin/python3 generate_digest.py >> output/cron.log 2>&1
```

### macOS alternative / Windows
- **macOS:** use `launchd` or the `cron` line above.
- **Windows:** open **Task Scheduler** → *Create Basic Task* → daily trigger →
  *Start a program* → `python` with argument `generate_digest.py` and
  *Start in* set to the `whatsapp-news` folder.

---

## Troubleshooting

- **"Could not fetch updates for this track"** — the machine couldn't reach
  Google News. Check your internet, VPN, or corporate firewall/proxy.
- **Empty tracks** — widen the `--hours` window or loosen the query.
- **Wrong region** — adjust `GNEWS_HL/GL/CEID` in the script.

---

## Files

```
whatsapp-news/
├── generate_digest.py     # the generator (stdlib only)
├── README.md              # this guide
└── output/                # dated, ready-to-paste posts land here
    └── digest-2026-08-01.txt   # worked sample
```
