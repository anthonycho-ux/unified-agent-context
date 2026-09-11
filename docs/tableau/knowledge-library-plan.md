# Tableau knowledge library: build and edit workbooks via browser and API

<!-- Author: Command Code, 2026-09-05. Sources: help.tableau.com REST API workbooks reference (fetched live 2026-09-05), aside-browser and fleet-ops skills, decisions made with the user in session. -->

TL;DR: Tableau workbooks are built and edited through a two-layer loop. The driver agent sets goals and verifies results. Aside Browser implements visually in Tableau web authoring and reports back what it sees. The Tableau REST API (Python tableauserverclient) is the harness for everything mechanical: backup before edit, publish, metadata, connections, refresh, and image-based verification. Current API version is 3.29 (Tableau Cloud June 2026 / Server 2026.2).

## Decision (2026-09-05, with the user)

- The actual implementation runs inside Aside Browser because it can see the dashboard. The driver hands over goals and intentions; Aside implements and gives visual feedback.
- The REST API is the harness, not the editor. Anything mechanical (rename, move project, swap connection credentials, publish, backup, extract refresh) is a deterministic PUT or POST and never a browser turn.
- Anything where seeing matters (viz construction, layout, chart type choice, visual QA) is an Aside turn.

## How Tableau editing actually works (verified against live docs 2026-09-05)

- The REST API cannot edit workbook content in place (sheets, viz, calculations). Content edits happen either through the download, edit, republish loop or by driving web authoring in a browser. The chosen path here is the browser.
- Key methods under {server}/api/3.29/sites/{site-id}:
  - Update Workbook: PUT workbooks/{id} (name, description, showTabs, owner, project, data freshness policy)
  - Update Workbook Connection: PUT workbooks/{id}/connections/{connection-id} (server address, port, username, password, auth type); PUT workbooks/{id}/connections with connectionLuids for selective multi-connection updates (API 3.27+)
  - Publish Workbook: POST workbooks?overwrite=true, multipart/mixed body, 64 MB in one call or Initiate/Append File Upload for larger; asJob=true for async publish
  - Download Workbook: GET workbooks/{id}/content?includeExtract=False
  - Revisions: GET workbooks/{id}/revisions, download a specific revision for rollback
  - Extract refresh: POST workbooks/{id}/refresh
  - New in API 3.29: Validate Workbook and Validate Workbook And Upload. They return JSON validation errors with line and column for hand-edited TWB XML. This closes the edit and verify loop without Tableau Desktop.
- A .twb file is XML. The official schema lives at github.com/tableau/tableau-document-schemas. The legacy tableaudocumentapi and the .NET Document API only cover connection strings; do not build on them.
- Permissions: non-admin callers need Write on the workbook and the project for updates. JWT scopes: tableau:workbooks:update, tableau:workbooks:create, tableau:workbooks:download, tableau:views:download.

## The two-layer knowledge library

Driver layer (Command Code skill tableau-driver, to be scaffolded):

- Goal decomposition into visual, checkable intentions using Tableau web authoring vocabulary: shelves, marks, filter cards, parameters, dashboards vs worksheets
- REST harness choreography: snapshot the workbook before each Aside session (download plus revision number; rollback is Download Workbook Revision), verify after by pulling GET views/{view-id}/image and inspecting the PNG independently instead of trusting the Aside report alone
- Session choreography: aside session resume for iterative edits, steer when Aside drifts, queue for follow-ups such as export to PDF

Aside layer (Aside skill plus memory):

- Check aside skills list for an existing Tableau skill before creating one. The skill holds the UI playbook: Tableau Cloud and Server URL patterns, edit mode entry, shelf drag and drop idioms, save and publish flow, and done criteria per task type
- Seed site facts (org URL, project layout, naming conventions) through aside exec so Aside memory accumulates org-specific knowledge over time

## Tradeoff

Visual driving is slower and less deterministic than scripted edits, and Aside sessions can drift mid-turn. Mitigation: REST snapshot before each session, REST image verification after, and tight single-intention turns instead of one large prompt.

## Pending work (todo list written 2026-09-05, execution deferred)

1. Check Aside for an existing Tableau skill (aside skills list, inspect candidates)
2. Determine the Aside skill creation mechanism (aside skills --help)
3. Scaffold the tableau-driver Command Code skill via skill-builder
4. Write tableau-driver references: REST harness (backup, rollback, verify), web authoring vocabulary, session choreography, feedback contract
5. Create or extend the Aside Tableau skill with the UI playbook
6. Draft the aside exec seed prompt (needs the Tableau site URL and project conventions from the user)
7. Validate: skills load cleanly, references readable, dry run of the goal, Aside, verify loop

## Sources

- REST API workbooks and views reference: https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_workbooks_and_views.htm
- REST API overview: https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api.htm
- Document API (connections only): https://www.tableau.com/developer/tools/document-api
- TWB schema: https://github.com/tableau/tableau-document-schemas
- tableauserverclient: https://github.com/tableau/tableauserverclient
