# India pack test fixtures

Every fixture here is synthetic. No NSE or Yahoo data could be downloaded while the
India pack was written (the session had no network access), so:

- **Chart data** (`SYNTH-*`, `SYN-*`): the US pack's real Yahoo Finance bars (TSLA and
  other US stocks, Oct 2026) moved onto the NSE clock by `retime.py`: each bar keeps its
  date and prices, its New York time minus 15 minutes becomes its India time (09:30 ET ->
  09:15 IST), and NSE holidays and bars at or after 15:30 are dropped. TSLA is renamed
  SYNTH and any other ticker X becomes SYN-X. Prices are US-dollar prices labelled as
  rupees. They test the code on realistic price paths and say nothing about any Indian
  stock. Each file carries a `_provenance` note.
- **NSE responses** (announcements, results, insider filings, bulk and block deals, the
  equity list): written by hand in the field formats documented by open-source NSE client
  libraries and the brokers' SDKs (see the India README), with SYNTH symbols and made-up
  values. Their formats were not checked against a live NSE response.
- **Broker files** (scrip masters, orders): hand-written in the field formats of the Angel
  One and Dhan SDKs, with fake IDs.

Before relying on a parser, run its tool once against the live source and compare.
