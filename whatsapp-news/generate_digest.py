#!/usr/bin/env python3
"""
Daily WhatsApp Channel news digest generator.

Gathers headlines across three tracks — Artificial Intelligence,
Higher Education & Accreditation (NAAC/NBA/UGC/AICTE/NEP), and
Ed-Tech & Research — from Google News RSS, then formats a single,
formal-English, WhatsApp-ready post you can paste into your Channel.

No third-party packages required (standard library only).

Usage:
    python3 generate_digest.py                 # generate today's digest
    python3 generate_digest.py --hours 24      # only items from last 24h
    python3 generate_digest.py --max 5         # max 5 items per track
    python3 generate_digest.py --print-only    # print, do not write a file
    python3 generate_digest.py --self-test     # run offline on bundled sample

Output:
    Prints the post to stdout and (unless --print-only) writes it to
    output/digest-YYYY-MM-DD.txt for easy copy-paste.
"""

import argparse
import html
import os
import re
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from xml.etree import ElementTree as ET

# --------------------------------------------------------------------------
# CONFIGURATION — edit the search queries here to tune what each track pulls.
# Each track is a Google News RSS search. Google News aggregates hundreds of
# publishers, so one well-crafted query covers a lot of ground. Boolean
# operators (OR, quotes, minus) work inside the query.
# --------------------------------------------------------------------------

# Region/language for Google News. en-IN / IN gives India-first results.
GNEWS_HL = "en-IN"
GNEWS_GL = "IN"
GNEWS_CEID = "IN:en"

TRACKS = [
    {
        "key": "ai",
        "title": "Artificial Intelligence",
        "emoji": "\U0001F916",  # robot
        "query": (
            '"artificial intelligence" OR "generative AI" OR "machine learning" '
            'OR "large language model" OR OpenAI OR Anthropic OR Gemini'
        ),
    },
    {
        "key": "highered",
        "title": "Higher Education & Accreditation",
        "emoji": "\U0001F393",  # graduation cap
        "query": (
            'NAAC OR NBA accreditation OR UGC OR AICTE OR "NEP 2020" '
            'OR "higher education" India university'
        ),
    },
    {
        "key": "edtech",
        "title": "Ed-Tech & Research",
        "emoji": "\U0001F4A1",  # bulb
        "query": (
            '"edtech" OR "AI in education" OR "education technology" '
            'OR "research funding" OR "academic research" India'
        ),
    },
]

USER_AGENT = "Mozilla/5.0 (compatible; WhatsAppDigestBot/1.0)"
REQUEST_TIMEOUT = 25  # seconds


def gnews_url(query: str) -> str:
    """Build a Google News RSS search URL for a query."""
    q = urllib.parse.quote(query)
    return (
        f"https://news.google.com/rss/search?q={q}"
        f"&hl={GNEWS_HL}&gl={GNEWS_GL}&ceid={GNEWS_CEID}"
    )


def fetch(url: str) -> str:
    """Fetch a URL and return decoded text. Raises on failure."""
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT) as resp:
        return resp.read().decode("utf-8", "ignore")


def parse_rss(xml_text: str):
    """Parse RSS XML into a list of item dicts: title, link, source, when."""
    items = []
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        return items
    for item in root.iter("item"):
        title = (item.findtext("title") or "").strip()
        link = (item.findtext("link") or "").strip()
        source_el = item.find("source")
        source = (source_el.text.strip() if source_el is not None and source_el.text else "")
        pub = item.findtext("pubDate") or ""
        when = None
        if pub:
            try:
                when = parsedate_to_datetime(pub)
                if when.tzinfo is None:
                    when = when.replace(tzinfo=timezone.utc)
            except (TypeError, ValueError):
                when = None
        # Google News formats titles as "Headline - Source". Split the source out.
        if not source and " - " in title:
            head, _, tail = title.rpartition(" - ")
            if head:
                title, source = head, tail
        title = html.unescape(title).strip()
        source = html.unescape(source).strip()
        if title and link:
            items.append({"title": title, "link": link, "source": source, "when": when})
    return items


def normalize(text: str) -> str:
    """Lowercased, punctuation-stripped key for de-duplication."""
    return re.sub(r"[^a-z0-9]+", " ", text.lower()).strip()


def collect_track(track: dict, hours: int, max_items: int, fetcher=fetch):
    """Fetch and shape one track's items. Returns (items, error_or_None)."""
    try:
        xml_text = fetcher(gnews_url(track["query"]))
    except Exception as exc:  # network, timeout, HTTP error, etc.
        return [], f"{type(exc).__name__}: {exc}"

    raw = parse_rss(xml_text)
    cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)

    seen = set()
    fresh = []
    for it in raw:
        if it["when"] is not None and it["when"] < cutoff:
            continue
        key = normalize(it["title"])[:80]
        if not key or key in seen:
            continue
        seen.add(key)
        fresh.append(it)

    # Newest first when timestamps exist; undated items keep feed order.
    fresh.sort(key=lambda x: x["when"] or datetime.min.replace(tzinfo=timezone.utc), reverse=True)
    return fresh[:max_items], None


def format_digest(date_str: str, tracks_output: list) -> str:
    """Build the final WhatsApp post string.

    tracks_output: list of (track_dict, items, error) tuples.
    WhatsApp markdown: *bold*, _italic_.
    """
    lines = []
    lines.append(f"*\U0001F4F0 Daily Briefing — {date_str}*")
    lines.append("_Artificial Intelligence • Higher Education • Ed-Tech_")
    lines.append("")

    total = 0
    for track, items, error in tracks_output:
        lines.append(f"*{track['emoji']} {track['title']}*")
        if error:
            lines.append("_Could not fetch updates for this track today._")
        elif not items:
            lines.append("_No significant updates in this window._")
        else:
            for i, it in enumerate(items, 1):
                total += 1
                src = f" ({it['source']})" if it["source"] else ""
                lines.append(f"{i}. {it['title']}{src}")
                lines.append(f"   {it['link']}")
        lines.append("")

    lines.append("—")
    lines.append("_Curated daily for our community. Follow the channel for tomorrow's briefing._")
    return "\n".join(lines).rstrip() + "\n", total


# --------------------------------------------------------------------------
# Offline self-test: a tiny bundled RSS sample proves parse + format work
# without any network access.
# --------------------------------------------------------------------------

SAMPLE_RSS = """<?xml version="1.0"?>
<rss version="2.0"><channel>
  <item>
    <title>New open model tops reasoning benchmarks - The Times of India</title>
    <link>https://example.com/a</link>
    <pubDate>{recent}</pubDate>
  </item>
  <item>
    <title>New open model tops reasoning benchmarks - Duplicate Source</title>
    <link>https://example.com/a-dup</link>
    <pubDate>{recent}</pubDate>
  </item>
  <item>
    <title>Old story that should be filtered out - Some Paper</title>
    <link>https://example.com/old</link>
    <pubDate>{old}</pubDate>
  </item>
</channel></rss>"""


def run_self_test() -> int:
    now = datetime.now(timezone.utc)
    recent = (now - timedelta(hours=2)).strftime("%a, %d %b %Y %H:%M:%S +0000")
    old = (now - timedelta(days=10)).strftime("%a, %d %b %Y %H:%M:%S +0000")
    sample = SAMPLE_RSS.format(recent=recent, old=old)

    def fake_fetch(_url):
        return sample

    track = TRACKS[0]
    items, error = collect_track(track, hours=36, max_items=6, fetcher=fake_fetch)
    assert error is None, f"unexpected error: {error}"
    assert len(items) == 1, f"expected 1 item after dedupe+recency, got {len(items)}"
    assert items[0]["source"] == "The Times of India", items[0]["source"]
    text, total = format_digest(now.strftime("%B %d, %Y"), [(track, items, None)])
    assert "Daily Briefing" in text and "reasoning benchmarks" in text
    assert total == 1
    print("SELF-TEST PASSED\n")
    print(text)
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate a daily WhatsApp news digest.")
    parser.add_argument("--hours", type=int, default=36,
                        help="Only include items published within the last N hours (default 36).")
    parser.add_argument("--max", type=int, default=6, dest="max_items",
                        help="Maximum items per track (default 6).")
    parser.add_argument("--out", default=None,
                        help="Output directory (default: ./output next to this script).")
    parser.add_argument("--print-only", action="store_true",
                        help="Print to stdout only; do not write a file.")
    parser.add_argument("--self-test", action="store_true",
                        help="Run offline on bundled sample data and exit.")
    args = parser.parse_args()

    if args.self_test:
        return run_self_test()

    now = datetime.now(timezone.utc)
    date_str = now.strftime("%B %d, %Y")

    tracks_output = []
    for track in TRACKS:
        items, error = collect_track(track, args.hours, args.max_items)
        if error:
            print(f"[warn] {track['title']}: {error}", file=sys.stderr)
        tracks_output.append((track, items, error))

    text, total = format_digest(date_str, tracks_output)
    print(text)

    if not args.print_only:
        out_dir = args.out or os.path.join(os.path.dirname(os.path.abspath(__file__)), "output")
        os.makedirs(out_dir, exist_ok=True)
        out_path = os.path.join(out_dir, f"digest-{now.strftime('%Y-%m-%d')}.txt")
        with open(out_path, "w", encoding="utf-8") as fh:
            fh.write(text)
        print(f"[saved] {out_path}  ({total} items)", file=sys.stderr)

    if total == 0:
        print("[note] No items collected. If every track failed, check your "
              "internet connection or firewall/proxy.", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
