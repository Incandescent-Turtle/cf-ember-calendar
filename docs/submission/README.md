# Submission materials (Space Apps 2026)

Drafts for the project page, the demo video and the public README. They're kept here for context. Edit the files directly; the copy in Claude Docs is no longer the source.

| File | What it is |
|---|---|
| `summary.txt` | Project summary, plain text to paste. Limit 1,500 characters; it's 1,442 (`python -c "print(len(open('docs/submission/summary.txt',encoding='utf-8').read().strip()))"`). |
| `project_page.md` | Full project description for the rich-text field |
| `video_script.md` | 30 s demo video script and recording checklist |
| `readme_draft.md` | Replacement for the top-level `README.md` |
| `criteria.md` | Internal: where each judging criterion is covered (don't paste) |

Sources: `docs/HARMONIZATION.md`, `docs/GLOBAL_BUILD.md`, `docs/REKINDLE_RESULTS.md`, `docs/DECISIONS.md`.

## Links

- **Main link: https://cf-ember-calendar.pages.dev/** Use this everywhere for now.
- **embercalendar.earth** is our domain, waiting on the DNS move to Cloudflare. Mention it only as "soon also at embercalendar.earth" until it loads in a private window. After that it can be the headline link, with pages.dev kept as the fallback.
- Data: https://huggingface.co/datasets/Incandescent-Turtle/cf-ember-calendar-data

## Open items before submitting

- [ ] **Team name** and member list.
- [ ] **Demo video URL.**
- [ ] **Domain:** see Links above. Switch the links only after embercalendar.earth is live.
- [ ] **Deploy** `s6b` → `main`, then recheck `/rekindle` and `/methodology` on the live site. The last check was before the Rekindle tab merged.
- [ ] **Rekindle numbers:** all come from `REKINDLE_RESULTS.md` (final at ~20:40). Anything marked **[confirm]** may change with the sims running now.
- [ ] **Video length limit:** `SUBMISSION.md` says 30 s (over 30 s = not eligible for global judging). Check it in the 2026 submission guide.
- [ ] **MODIS end dates** (Terra ~Jan 2027, Aqua ~Sep 2027) come from our docs, not from a checked source. Check them against a NASA page or drop the months.
- [ ] **Global harmonized table:** keep its download line only if it was uploaded (`sync_data.sh --exports-only`).
- [ ] **AI use disclosure**, if the form asks for one (draft in `project_page.md`).
- [ ] Decide whether to keep the "what didn't help" paragraph (a count ratio calibrates as well as FCD) in `project_page.md`.
