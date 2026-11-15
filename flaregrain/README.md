# Flaregrain

Flaregrain is an evidence dashboard for the NASA Space Apps 2026 challenge "Flame in Freefall", built by Sparkline Foundry at NASA Space Apps Halifax. It answers plain-language questions about NASA's microgravity fire experiments, and every NASA value links to the report page or table it came from.

**Live site:** https://flaregrain-submission.vercel.app

## What the site does

- **Ask:** type a question. The server ranks the closest checked NASA records and report pages, and the page shows them with their links.
  - On the live site, a small open model (qwen3:4b, on the team's own computer) writes up to four sentences from those sources. A sentence checker keeps only the sentences that match the facts they cite, and the page says how many it removed. Model text is labelled "AI summary".
  - Without the model, Ask shows the closest evidence, and one prepared question shows an answer the team checked by hand.
- **Compare:** two of the 11 comparable checked runs side by side, with what they share, how they differ, and what the sources leave open.
- **Evidence** and **Browse:** the 13 hand-checked records and the evidence trail behind them.
- **Fire beyond Earth:** seven habitat atmospheres, from ISS cabin air to a Moon base, with how many NASA table rows were tested near each and what is untested.
- **Findings** and **System design:** four evidence findings, and how the data, ranking, model and checker fit together.

## Run it

From the repository root with Node.js 22 or later, run `node flaregrain/redesign/server.mjs` and open [the local app](http://127.0.0.1:8790/). It needs no account. Run this way, the model is off: Ask shows the closest evidence and the prepared answer, and Compare shows its saved explanations.

This build carries the 13 hand-checked NASA records in `data/compare-data.json`: 11 runs, with a prepared comparison for each of the 110 ordered pairs, and SAME's two Kapton material baselines. The comparisons come from the dashboard's rule-based Compare; where two NASA sources disagree on a value, the comparison marks it disputed and keeps both. Ask answers the airflow cutoff question from the BASS-II B1 and Saffire I-1 reports. Browse and Evidence show all 13 records. Habitat, Atlas, System design and wider evidence summaries require the wider dataset and display the submission scope. NASA figures and page crops remain in the linked reports.

Nora Forghani designed and implemented the landing, flame, Ask, Compare and shared drawer. The app retains the original asset URLs for [Three.js r128](https://github.com/mrdoob/three.js/blob/r128/LICENSE), [Hanken Grotesk](https://github.com/google/fonts/blob/main/ofl/hankengrotesk/OFL.txt) and [JetBrains Mono](https://github.com/google/fonts/blob/main/ofl/jetbrainsmono/OFL.txt).

The team: José Pablo Samano, Nora Forghani, Osman Khurram and Grish Acharya. [NOTICE.md](NOTICE.md) covers the NASA data terms, third-party licences and how AI tools were used; [PROVENANCE.md](PROVENANCE.md) gives the dates and authors of each part; [ENGINEERING.md](ENGINEERING.md) gives what was measured.

## Browse the evidence

[Open the evidence browser source](evidence/browser/index.html). To use the page, clone or download this repository and open `flaregrain/evidence/browser/index.html` in your browser. Filter the three published examples by reported measurement, missing value, or disputed value. Each entry links to the original NASA sources.

## Run Compare

From the repository root, run `python3 -I flaregrain/build.py` and open `flaregrain/dist/index.html`. Choose **Airflow cutoff** to compare BASS-II B1 with Saffire I-1, or pick any two of the 11 runs. The records and their citations are included in the build. The page opens without an account or backend service.

The [airflow shutoff evidence](evidence/airflow-shutoff-source-trace.md) and [Saffire thickness note](evidence/saffire-disputed-thickness.md) explain the scientific limits and link to the original NASA sources. Nora Forghani authored the Compare page and record drawer. This package adapts them for a static build from the two checked records.

## Checks

Python 3.9 or later, standard library only. Run from the repository root:

    python3 -I flaregrain/tests/run.py
    python3 -I flaregrain/build.py --check

`dist/` holds the generated output. It is not committed, and publishing it is a separate deploy step.

The build embeds JavaScript and CSS inline. If source text needs to contain a literal HTML end tag, use the language's string escapes so the HTML parser cannot read it as markup.

## Evidence rules

Every NASA value links to its source, and where two sources disagree both values are shown. Flaregrain's own readings and models are labelled as ours and are never styled as NASA evidence.
