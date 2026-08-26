import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, ExternalLink } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { GridBg, NB, Header, Footer } from "@/components/LandingShell";
import { LineSidebar } from "@/components/LineSidebar";

const SITE = "https://satyam.ksp.local";

export const Route = createFileRoute("/about")({
  head: () => ({
    meta: [
      { title: "How Satyam works — bilingual crime intelligence for Karnataka State Police" },
      {
        name: "description",
        content:
          "A complete technical handbook for Satyam: the grounded query pipeline, the SQL guard, rank-based access control and Postgres row-level security, the tamper-evident audit chain, hybrid BGE-M3 retrieval, and the English/Kannada voice path.",
      },
      {
        name: "keywords",
        content:
          "crime intelligence, Karnataka State Police, text-to-SQL, retrieval augmented generation, pgvector, row-level security, audit chain, Kannada NLP, bilingual voice assistant, police analytics",
      },
      { name: "robots", content: "index, follow" },
      { name: "author", content: "Teen Titans" },

      { property: "og:site_name", content: "Satyam" },
      { property: "og:title", content: "How Satyam works — a technical handbook" },
      {
        property: "og:description",
        content:
          "Five chapters on how Satyam answers a police question: intent routing, grounded retrieval, the SQL guard, row-level security, and the tamper-evident audit chain.",
      },
      { property: "og:url", content: `${SITE}/about` },
      { property: "og:type", content: "article" },
      { property: "og:locale", content: "en_IN" },
      { property: "og:locale:alternate", content: "kn_IN" },

      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "How Satyam works — a technical handbook" },
      {
        name: "twitter:description",
        content:
          "Intent routing, grounded retrieval, the SQL guard, row-level security, and a hash-chained audit log.",
      },
    ],
    links: [
      { rel: "canonical", href: `${SITE}/about` },
      { rel: "alternate", hrefLang: "en-IN", href: `${SITE}/about` },
      { rel: "alternate", hrefLang: "kn-IN", href: `${SITE}/about` },
    ],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@graph": [
            {
              "@type": "TechArticle",
              "@id": `${SITE}/about#article`,
              headline: "How Satyam works",
              description:
                "A technical handbook covering Satyam's grounded query pipeline, access-control model, retrieval stack and bilingual voice path.",
              inLanguage: ["en-IN", "kn-IN"],
              author: { "@type": "Organization", name: "Teen Titans" },
              about: [
                { "@type": "Thing", name: "Crime intelligence" },
                { "@type": "Thing", name: "Retrieval-augmented generation" },
                { "@type": "Thing", name: "Row-level security" },
              ],
              isPartOf: { "@id": `${SITE}/#website` },
            },
            {
              "@type": "SoftwareApplication",
              "@id": `${SITE}/#app`,
              name: "Satyam",
              applicationCategory: "BusinessApplication",
              operatingSystem: "Web",
              description:
                "Bilingual, voice-enabled crime-intelligence assistant for Karnataka State Police. Runs on synthetic data.",
              featureList: [
                "Natural-language Text-to-SQL over case records",
                "Hybrid semantic and lexical narrative retrieval",
                "Crime hotspot and link-network analytics",
                "Rank-based access control with Postgres row-level security",
                "Tamper-evident hash-chained audit log",
                "English and Kannada speech input and output",
              ],
            },
            {
              "@type": "WebSite",
              "@id": `${SITE}/#website`,
              name: "Satyam",
              url: `${SITE}/`,
            },
            {
              "@type": "BreadcrumbList",
              itemListElement: [
                { "@type": "ListItem", position: 1, name: "Home", item: `${SITE}/` },
                { "@type": "ListItem", position: 2, name: "How it works", item: `${SITE}/about` },
              ],
            },
          ],
        }),
      },
    ],
  }),
  component: AboutPage,
});

type Block =
  | { kind: "p"; text: string }
  | { kind: "note"; title: string; text: string }
  | { kind: "list"; items: string[] }
  | { kind: "steps"; items: { label: string; text: string }[] }
  | { kind: "table"; head: string[]; rows: string[][] };

type Section = { id: string; heading: string; blocks: Block[] };
type Chapter = { id: string; title: string; lede: string[]; sections: Section[] };

function AboutPage() {
  const { t } = useI18n();

  /**
   * Every chapter is rendered into the document at once and the rail scrolls to
   * them, rather than swapping one chapter in at a time.
   *
   * The reference design shows a single chapter per view, which a `activeChapter`
   * state would reproduce — but it would also mean only one chapter of the
   * handbook is ever in the DOM, so a crawler indexes chapter one and nothing
   * else. Since the point of this page is to be the discoverable explanation of
   * the project, all of it stays in the markup and the reading experience is
   * produced by scroll position instead.
   */
  const chapters: Chapter[] = useMemo(
    () => [
      {
        id: "overview",
        title: t("Overview"),
        lede: [
          t(
            "Satyam is a bilingual, voice-enabled crime-intelligence assistant built for the Karnataka State Police. An officer asks a question in English or Kannada, by typing or speaking, and gets an answer assembled from case records their rank is cleared to see.",
          ),
          t(
            "The whole system is organised around one refusal: the language model is never allowed to answer from memory. It may decide what kind of question was asked, and it may put an answer into words. It may not supply the facts.",
          ),
        ],
        sections: [
          {
            id: "problem",
            heading: t("The problem it addresses"),
            blocks: [
              {
                kind: "p",
                text: t(
                  'Police case data is not hard to store; it is hard to ask questions of. Counts live in one table, statements live in unstructured narrative text, relationships between people are implicit in who appears on which case, and geography is a pair of coordinates. Answering something as ordinary as "which stations near Hubballi logged the most two-wheeler thefts last year, and are any of the accused connected?" means joining four of those shapes by hand.',
                ),
              },
              {
                kind: "p",
                text: t(
                  "The other half of the problem is authority. Two officers asking the identical question must not receive the identical answer, because a station-level constable and a state-level ADGP are not entitled to the same rows. Any system that answers questions over this data has to enforce that difference in a way that survives an operator making a mistake.",
                ),
              },
            ],
          },
          {
            id: "grounding",
            heading: t("What grounded means here"),
            blocks: [
              {
                kind: "p",
                text: t(
                  "A grounded answer is one where every claim can be traced back to a row that was actually read from the database during that request. Satyam achieves that by never asking the model for facts. Instead the model picks a lane, and the lane goes and gets real data.",
                ),
              },
              {
                kind: "steps",
                items: [
                  {
                    label: t("sql_query"),
                    text: t(
                      "Structured questions about counts, rates and case lists. The model proposes SQL; a parser rewrites and constrains it before it runs.",
                    ),
                  },
                  {
                    label: t("narrative_search"),
                    text: t(
                      "Questions about what happened, answered from case narrative text by hybrid semantic and keyword retrieval.",
                    ),
                  },
                  {
                    label: t("hotspot"),
                    text: t(
                      "Geographic concentration of a crime type, aggregated into map cells. Requires clearance L2 or above.",
                    ),
                  },
                  {
                    label: t("network"),
                    text: t(
                      "Link analysis around a named person, either their full ego network or a victim-offender framing when the question implies direction.",
                    ),
                  },
                  {
                    label: t("report"),
                    text: t(
                      "Recognised, then handed to the Reports screen. The chat lane does not itself produce a document.",
                    ),
                  },
                  {
                    label: t("smalltalk"),
                    text: t(
                      "Greetings and questions about Satyam itself. This is the only lane allowed to answer without touching the database.",
                    ),
                  },
                ],
              },
            ],
          },
          {
            id: "dataset",
            heading: t("The dataset"),
            blocks: [
              {
                kind: "p",
                text: t(
                  "Every record shipped with Satyam is synthetic. Nothing in the system is real case data, no real person appears in it, and it is not used to make predictions about individuals. The generator produces a coherent corpus rather than random noise, so link analysis and hotspot aggregation return structure worth looking at.",
                ),
              },
              {
                kind: "table",
                head: [t("Table"), t("Rows")],
                rows: [
                  [t("cases"), "35,993"],
                  [t("narratives"), "71,986"],
                  [t("persons"), "249,972"],
                  [t("case_persons"), "90,496"],
                  [t("financial_accounts"), "64,127"],
                  [t("financial_transactions"), "16,353"],
                  [t("district_socio_economic_indicators"), "41"],
                ],
              },
              {
                kind: "note",
                title: t("Two narratives per case"),
                text: t(
                  "Each case carries an English narrative and a Kannada one, which is why the narrative count is exactly twice the case count. This matters for retrieval, and Chapter IV explains why only half of them are currently searchable by meaning.",
                ),
              },
            ],
          },
        ],
      },

      {
        id: "pipeline",
        title: t("How a question is answered"),
        lede: [
          t(
            "One request, start to finish. A question arrives at the streaming chat endpoint, is classified, dispatched to a grounded lane, composed into prose, and streamed back while an audit record is written.",
          ),
        ],
        sections: [
          {
            id: "ingest",
            heading: t("Ingest and language detection"),
            blocks: [
              {
                kind: "p",
                text: t(
                  "A question can be typed or spoken. Spoken audio is uploaded to the speech endpoint, which by default asks the recogniser to identify the language itself rather than being told, and returns the detected language alongside the transcript.",
                ),
              },
              {
                kind: "p",
                text: t(
                  "There is a second, cheaper detector in the browser: if any character in the text falls inside the Kannada Unicode block, the text is treated as Kannada. That decides which language the reply is composed and spoken in. The two detectors are independent on purpose, so typed Kannada is handled without involving a speech model at all.",
                ),
              },
            ],
          },
          {
            id: "routing",
            heading: t("Intent routing, and what happens when it fails"),
            blocks: [
              {
                kind: "p",
                text: t(
                  "The router asks a language model to return a strict JSON object naming one of the six lanes plus any parameters it can extract, at temperature zero. The result is validated against the list of real lane names, so a hallucinated lane is discarded rather than dispatched.",
                ),
              },
              {
                kind: "steps",
                items: [
                  {
                    label: t("Primary"),
                    text: t("The configured brain model, currently Gemini by default."),
                  },
                  {
                    label: t("Fallback"),
                    text: t(
                      "A second provider, attempted only when it is a different provider from the primary — one rate limit should not take out both lanes.",
                    ),
                  },
                  {
                    label: t("Keywords"),
                    text: t(
                      "A deterministic pattern matcher, ordered most-specific first. It always produces a lane, so the system degrades instead of failing, and it records that routing is degraded.",
                    ),
                  },
                ],
              },
            ],
          },
          {
            id: "lanes",
            heading: t("Executing the lane"),
            blocks: [
              {
                kind: "p",
                text: t(
                  "Each lane returns rows plus citations. The structured lane cites FIR numbers; the narrative lane cites case identifiers, and deliberately omits any record whose text was withheld for clearance, because citing a source the reader is not allowed to open is worse than not citing it.",
                ),
              },
              {
                kind: "p",
                text: t(
                  "The structured lane can also recover. If a generated query returns nothing, the filters are progressively broadened — first the year, then the crime type, then the place — and the answer states plainly that the question had to be widened, rather than reporting zero results as though the answer were zero.",
                ),
              },
            ],
          },
          {
            id: "compose",
            heading: t("Composing the answer"),
            blocks: [
              {
                kind: "p",
                text: t(
                  "The retrieved rows are handed to a model with instructions to summarise only what it was given. It is also asked to mark a two-to-three sentence spoken version inside a delimiter, which is extracted and sent as its own event so the voice reply is a briefing rather than a machine reading a table aloud. If the model omits it, the spoken summary is built from the rows in code instead.",
                ),
              },
              {
                kind: "p",
                text: t(
                  "Kannada answers take two passes. The answer is composed in English, translated, and then run through a deterministic dictionary that fixes crime types, case statuses, district and station names, and table headers. The second pass exists because a translation model asked to preserve police terminology does not reliably do so.",
                ),
              },
              {
                kind: "note",
                title: t("Streaming is presentational"),
                text: t(
                  "Words arrive one at a time in the interface, but the model call is awaited in full first and the finished answer is then split and emitted in pieces. It reads like token streaming and is not. Worth knowing before timing anything against it.",
                ),
              },
            ],
          },
          {
            id: "events",
            heading: t("What the browser receives"),
            blocks: [
              {
                kind: "p",
                text: t(
                  "The reply is a server-sent event stream. Every frame is a JSON object carrying its own type, which the client switches on:",
                ),
              },
              {
                kind: "table",
                head: [t("Event"), t("Meaning")],
                rows: [
                  [
                    "tool",
                    t(
                      "A lane started or finished. Carries a detail string — the sanitised SQL, or the retrieval strategy and hit count.",
                    ),
                  ],
                  [
                    "blocked",
                    t("The question was refused, by guardrails or by insufficient permission."),
                  ],
                  ["speak", t("The short spoken summary, sent once, ahead of the written answer.")],
                  ["token", t("A chunk of the written answer.")],
                  ["citation", t("A source reference, or a deep link into another screen.")],
                  ["done", t("End of turn, carrying the conversation identifier.")],
                ],
              },
              {
                kind: "note",
                title: t("Why the stream manages its own database session"),
                text: t(
                  "The access-control context is set as transaction-local database settings. A session injected by the framework is released when the handler returns — which, for a streaming response, is before the first frame is produced. The endpoint therefore opens and holds its own session for the life of the stream. Without that, the security context would be gone by the time any data was read.",
                ),
              },
            ],
          },
        ],
      },

      {
        id: "security",
        title: t("Authority and evidence integrity"),
        lede: [
          t(
            "Two officers asking the same question should not get the same answer. This chapter covers how Satyam decides who sees what, how it stops a generated query from becoming a liability, and how it makes its own log impossible to edit quietly.",
          ),
        ],
        sections: [
          {
            id: "rank",
            heading: t("Rank becomes scope and clearance"),
            blocks: [
              {
                kind: "p",
                text: t(
                  "At sign-in, an officer's rank is resolved into two independent things. Scope answers how wide: which rows exist for this person. Clearance answers how deep: which capabilities and which sensitive fields are available. They are separate because seniority in geography and entitlement to protected material are not the same axis.",
                ),
              },
              {
                kind: "table",
                head: [t("Scope"), t("Ranks"), t("Rows visible")],
                rows: [
                  [t("State"), "DGP, ADGP, IGP", t("All records")],
                  [t("Range"), "DIG", t("Records in the officer's range")],
                  [t("District"), "SP, Addl.SP, DySP", t("Records in the officer's district")],
                  [
                    t("Station"),
                    "CPI, PI, CI, PSI, SI, ASI, HC, PC",
                    t("Records for the officer's station"),
                  ],
                ],
              },
              {
                kind: "table",
                head: [t("Capability"), t("Minimum clearance")],
                rows: [
                  [t("Ask a question, read a case"), "L1"],
                  [t("Run hotspot and network analytics, build a report"), "L2"],
                  [t("Read sensitive fields, read the audit log"), "L3"],
                  [t("Read protected-crime records, administer access"), "L4"],
                ],
              },
              {
                kind: "p",
                text: t(
                  "A defined set of crime categories is treated as protected, including offences under POCSO and crimes against women and against Scheduled Castes and Tribes. A narrative attached to a protected case is withheld below L3, and the full case record requires L4. When a protected record matches a search, the officer is told that a restricted record matched without being shown its contents — silently dropping it would misrepresent the result as an absence.",
                ),
              },
            ],
          },
          {
            id: "rls",
            heading: t("Row scoping in the database, not the application"),
            blocks: [
              {
                kind: "p",
                text: t(
                  "Scope is applied by Postgres row-level security. At the start of each request the officer's scope, range, district, station and clearance are written as transaction-local settings, and the table policies filter against those. A statement timeout is set in the same breath, so a pathological generated query cannot occupy a connection indefinitely.",
                ),
              },
              {
                kind: "p",
                text: t(
                  "Placing this in the database rather than in application code is the whole point: it holds for every query that session makes, including one a language model wrote, and including one added later by a developer who has not read this page.",
                ),
              },
            ],
          },
          {
            id: "guard",
            heading: t("The SQL guard"),
            blocks: [
              {
                kind: "p",
                text: t(
                  "Generated SQL is parsed before it is trusted, and what runs is regenerated from the parse tree rather than being the model's original text. A query has to satisfy all of the following:",
                ),
              },
              {
                kind: "list",
                items: [
                  t(
                    "Exactly one statement, which closes off statement chaining and comment injection.",
                  ),
                  t(
                    "A SELECT. Any insert, update, delete or schema change anywhere in the tree is rejected.",
                  ),
                  t(
                    "Only the six allow-listed tables: cases, persons, case_persons, stations, officers and narratives.",
                  ),
                  t(
                    "A row limit, which is added when absent and reduced when it exceeds the ceiling of 200.",
                  ),
                ],
              },
              {
                kind: "note",
                title: t("What the guard does not do"),
                text: t(
                  "The guard decides the shape of the query, not who may see the rows it returns. Row scoping is row-level security's job, and column-level masking of personal fields is applied in the application layer after the query runs, for callers below clearance L3. Those are three separate mechanisms and it is worth not confusing them.",
                ),
              },
              {
                kind: "p",
                text: t(
                  "The same guard also validates the deterministic query builder used when no model is available, so there is one enforcement point rather than one per code path.",
                ),
              },
            ],
          },
          {
            id: "audit",
            heading: t("An audit log that cannot be edited quietly"),
            blocks: [
              {
                kind: "p",
                text: t(
                  "Every audited action appends a row whose hash covers both its own canonical contents and the hash of the row before it. Changing or deleting any earlier entry breaks every hash after it, which a single pass over the table detects.",
                ),
              },
              {
                kind: "steps",
                items: [
                  {
                    label: t("Serialise"),
                    text: t(
                      "A transaction-level advisory lock is taken so concurrent writers cannot read the same previous hash and fork the chain into two valid-looking branches.",
                    ),
                  },
                  {
                    label: t("Link"),
                    text: t(
                      "The previous row's hash is read, or a fixed genesis value for the first entry.",
                    ),
                  },
                  {
                    label: t("Canonicalise"),
                    text: t(
                      "The entry is serialised with sorted keys and fixed separators, so the same content always produces the same bytes.",
                    ),
                  },
                  {
                    label: t("Hash"),
                    text: t("SHA-256 over the previous hash concatenated with those bytes."),
                  },
                ],
              },
              {
                kind: "p",
                text: t(
                  "The chat path writes its audit row in a separate committed transaction, before streaming begins. If it shared the stream's transaction, a reader closing the tab mid-answer would roll back the evidence that the question was ever asked.",
                ),
              },
            ],
          },
        ],
      },

      {
        id: "retrieval",
        title: t("Retrieval and language"),
        lede: [
          t(
            "How Satyam searches unstructured narrative text, and how the same answer is produced in two languages.",
          ),
        ],
        sections: [
          {
            id: "hybrid",
            heading: t("Two search strategies, fused"),
            blocks: [
              {
                kind: "p",
                text: t(
                  "Narrative search runs a meaning-based search and a keyword search on every query, and combines them. Semantic search finds a chain snatching described without using the word snatching; keyword search reliably finds a vehicle registration or a specific section number, which an embedding tends to blur.",
                ),
              },
              {
                kind: "steps",
                items: [
                  {
                    label: t("Embed"),
                    text: t(
                      "BGE-M3 produces a 1024-dimension vector, normalised so cosine similarity is the operator the database index already uses.",
                    ),
                  },
                  {
                    label: t("Search"),
                    text: t(
                      "An approximate nearest-neighbour scan over stored narrative vectors, and a Postgres full-text search served by its own index.",
                    ),
                  },
                  {
                    label: t("Fuse"),
                    text: t(
                      "Reciprocal rank fusion combines the two orderings. It uses only rank position, not score, because a cosine distance and a text-rank score are not on comparable scales and calibrating them would need tuning data this project does not have.",
                    ),
                  },
                  {
                    label: t("Rerank"),
                    text: t(
                      "A cross-encoder reads each candidate against the question and reorders them. This is a quality step, so if it fails the fused order is used rather than losing the results.",
                    ),
                  },
                ],
              },
              {
                kind: "note",
                title: t("Empty is not the same as broken"),
                text: t(
                  "Each strategy reports separately whether it was able to run at all, distinct from whether it matched anything. An earlier version collapsed those two states, and because a search over unembedded records returns zero rows without raising an error, the keyword fallback could never be reached — the lane returned nothing for every question, with no error and no log line. Keeping availability and emptiness apart is what makes the fallback reachable.",
                ),
              },
            ],
          },
          {
            id: "coverage",
            heading: t("Current retrieval coverage"),
            blocks: [
              {
                kind: "p",
                text: t(
                  "Half the narrative corpus is searchable by meaning: 35,993 of 71,986 narratives carry an embedding. Those are the English ones. The Kannada narratives are stored and keyword-searchable, but not embedded.",
                ),
              },
              {
                kind: "p",
                text: t(
                  "That is a budget decision rather than an oversight. The database has a hard storage ceiling, and past it the provider rejects writes that grow storage — which would include the audit row written on every query, making it an availability problem rather than a billing one. Each additional embedded narrative costs roughly 4.8 KB once its share of the vector index is counted, and embedding the remaining half would push the database past the cap. Every backfill projects its own cost first and refuses to start if it would not fit.",
                ),
              },
              {
                kind: "note",
                title: t("Known weakness in Kannada keyword search"),
                text: t(
                  "The keyword index is built without language-specific processing and requires every term in the query to appear, so recall on Kannada narratives is poor. Semantic search is the proper fix, and it is the half of the corpus that is not yet embedded.",
                ),
              },
            ],
          },
          {
            id: "voice",
            heading: t("The bilingual voice path"),
            blocks: [
              {
                kind: "p",
                text: t(
                  "Speech in and speech out both run through hosted Indic models. Recognition is asked to detect the language rather than being told it. Synthesis is given the target language and a fixed voice, and the text is trimmed on a sentence boundary to stay inside the provider's input limit, so a long answer is cut cleanly instead of mid-word.",
                ),
              },
              {
                kind: "p",
                text: t(
                  "Voice does more than dictate. Spoken commands are matched against a route table covering every screen in both languages, so an officer can say the Kannada or English name of a screen and be taken there. Where a command implies work rather than navigation, a planner turns it into actions the destination screen executes on arrival, with placeholders resolved against records the officer is actually allowed to see.",
                ),
              },
            ],
          },
        ],
      },

      {
        id: "platform",
        title: t("The platform"),
        lede: [
          t(
            "The screens an officer works in, the models behind them, and what is genuinely finished versus what is scaffolding.",
          ),
        ],
        sections: [
          {
            id: "screens",
            heading: t("Screens"),
            blocks: [
              {
                kind: "table",
                head: [t("Screen"), t("Purpose")],
                rows: [
                  [
                    t("Ask Satyam"),
                    t("The conversational surface: streamed answers, citations, voice in and out."),
                  ],
                  [
                    t("Dashboard"),
                    t("Case triage and indicators, with a drawer for any individual record."),
                  ],
                  [
                    t("Network"),
                    t("Link and ego networks around a person, including financial links."),
                  ],
                  [t("Forecast"), t("Forward-looking aggregate views.")],
                  [t("Trends"), t("Time-series movement across crime types and geographies.")],
                  [t("Reports"), t("Assembling findings into a printable document.")],
                  [t("Audit"), t("Reading the action log and verifying the hash chain.")],
                  [t("Transcripts"), t("History of voice interactions.")],
                  [t("Vision"), t("Tactical geospatial surface.")],
                  [t("Board"), t("Free-form investigation canvas.")],
                  [t("Person 360"), t("Consolidated view of one individual. Restricted.")],
                  [t("Access Control"), t("Managing officer accounts and policy. L4 only.")],
                ],
              },
            ],
          },
          {
            id: "models",
            heading: t("Models, and why they are swappable"),
            blocks: [
              {
                kind: "p",
                text: t(
                  "Models sit behind a registry, so a lane asks for a capability rather than for a vendor. The brain model, the model that writes SQL, and the voice provider are selected independently and can be changed from the Settings panel per request, without a redeploy.",
                ),
              },
              {
                kind: "table",
                head: [t("Role"), t("Default"), t("Alternatives")],
                rows: [
                  [t("Reasoning and routing"), "Gemini", t("Groq, OpenAI")],
                  [t("Text-to-SQL"), "Gemini", t("Qwen3 Coder via Ollama Cloud")],
                  [t("Embeddings"), "BGE-M3", t("None — deliberately the only embedder")],
                  [t("Reranking"), "BGE Reranker v2-m3", t("None")],
                  [t("Speech and translation"), "Sarvam", t("Google Cloud voice")],
                ],
              },
              {
                kind: "p",
                text: t(
                  "Embeddings are the exception with no alternative. A vector store is only coherent if every vector in it came from the same model, so allowing a second embedder would silently corrupt retrieval rather than degrade it.",
                ),
              },
            ],
          },
          {
            id: "status",
            heading: t("Honest status"),
            blocks: [
              {
                kind: "p",
                text: t(
                  "Some parts of the system are scaffolding, and it is more useful to say so than to let someone discover it during an evaluation.",
                ),
              },
              {
                kind: "list",
                items: [
                  t(
                    "Fully offline operation is not available. Selecting the local model backend gives placeholder responses rather than a self-hosted model; the interfaces exist and the implementations do not.",
                  ),
                  t(
                    "One of the two Indic speech providers is stubbed. The default provider works; the alternative is an interface awaiting its compute call.",
                  ),
                  t(
                    "The chat lane for reports recognises the request and points at the Reports screen. It does not generate a document.",
                  ),
                  t(
                    "Half the narrative corpus is not embedded, bounded by the storage ceiling described in Chapter IV.",
                  ),
                  t(
                    "Written answers appear to stream but are composed in full before the first word is sent.",
                  ),
                ],
              },
            ],
          },
          {
            id: "stack",
            heading: t("Stack"),
            blocks: [
              {
                kind: "table",
                head: [t("Layer"), t("Choices")],
                rows: [
                  [t("Interface"), "React 19, TanStack Start, Vite, Tailwind CSS v4"],
                  [t("Visualisation"), "React Flow, Leaflet, Recharts, Three.js, tldraw"],
                  [t("Service"), "Python 3.11, FastAPI, SQLAlchemy, asyncpg, structlog"],
                  [t("Data"), "PostgreSQL 16 with pgvector, Redis"],
                  [t("Safety"), "sqlglot, PyJWT, Postgres row-level security, advisory locks"],
                ],
              },
            ],
          },
        ],
      },
    ],
    [t],
  );

  const [activeChapter, setActiveChapter] = useState(0);
  const [activeSection, setActiveSection] = useState<string>(chapters[0].sections[0].id);
  const suppressSpy = useRef(false);

  /**
   * Scrollspy, computed from scroll position rather than with an
   * IntersectionObserver.
   *
   * The observer version tracked a band near the top of the viewport and picked
   * whichever heading was inside it. That leaves holes: at the very top of the
   * document, and anywhere the gap between two headings is taller than the band,
   * nothing intersects, the callback has no entries to choose from, and the rail
   * keeps whatever chapter it last showed. Scrolling back to the top left it
   * highlighting the final chapter.
   *
   * Picking the last heading that has passed the reading line has no such hole:
   * there is always an answer, including above the first heading and below the
   * last.
   */
  useEffect(() => {
    const index = new Map<string, number>();
    chapters.forEach((c, ci) => c.sections.forEach((s) => index.set(s.id, ci)));
    const ids = chapters.flatMap((c) => c.sections.map((s) => s.id));

    // The line a heading has to cross to count as what you are reading. Just
    // below the sticky header.
    const READING_LINE = 140;
    let queued = false;

    const recompute = () => {
      queued = false;
      if (suppressSpy.current) return;

      let currentId = ids[0];
      for (const id of ids) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top <= READING_LINE) currentId = id;
        else break;
      }
      setActiveSection(currentId);
      const ci = index.get(currentId);
      if (ci !== undefined) setActiveChapter(ci);
    };

    const onScroll = () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(recompute);
    };

    recompute();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [chapters]);

  const goTo = useCallback((id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    // The observer would otherwise fire for every heading passed on the way and
    // leave the rail on whichever one happened to be last.
    suppressSpy.current = true;
    setActiveSection(id);
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    window.setTimeout(() => {
      suppressSpy.current = false;
    }, 700);
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <GridBg />
      <Header />

      <div className="mx-auto max-w-7xl px-6 py-12">
        <div className="grid gap-12 lg:grid-cols-[15rem_minmax(0,1fr)]">
          {/* ── Chapter rail ─────────────────────────────────────────────── */}
          <aside className="hidden lg:block">
            <div className="sticky top-28">
              <div className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-foreground/45">
                {t("The Satyam handbook")}
              </div>

              <LineSidebar
                className="mt-5"
                items={chapters.map((c) => c.title)}
                showIndex
                showMarker
                proximityRadius={64}
                maxShift={14}
                falloff="smooth"
                markerLength={26}
                markerGap={6}
                tickScale={0.45}
                scaleTick
                itemGap={14}
                fontSize={0.82}
                smoothing={78}
                activeIndex={activeChapter}
                onItemClick={(i) => {
                  setActiveChapter(i);
                  goTo(chapters[i].sections[0].id);
                }}
              />

              {/* Sub-sections of whichever chapter is being read. */}
              <div className="line-subnav mt-5 border-t-2 border-foreground/15 pt-4">
                {chapters[activeChapter].sections.map((s) => (
                  <a
                    key={s.id}
                    href={`#${s.id}`}
                    aria-current={activeSection === s.id ? "true" : undefined}
                    onClick={(e) => {
                      e.preventDefault();
                      goTo(s.id);
                    }}
                  >
                    {s.heading}
                  </a>
                ))}
              </div>
            </div>
          </aside>

          {/* ── Handbook body ───────────────────────────────────────────── */}
          <main className="min-w-0">
            <header className="max-w-3xl">
              <div className="inline-block rounded-[5px] border-2 border-foreground bg-secondary-background px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wider nb-shadow-sm">
                {t("How it works")}
              </div>
              <h1 className="mt-4 text-4xl font-extrabold leading-[1.05] tracking-tight md:text-5xl">
                {t("Answers an officer can")}{" "}
                <span className="inline-block rounded-[5px] border-2 border-foreground bg-primary px-2 text-primary-foreground nb-shadow">
                  {t("take to court")}
                </span>
              </h1>
              <p className="mt-5 text-base leading-relaxed text-foreground/75">
                {t(
                  "Satyam answers questions about crime records in English and Kannada, by voice or by typing. This handbook is the complete account of how it does that — the routing, the grounding, the access model, and the parts that are not finished.",
                )}
              </p>
              <p className="mt-4 inline-flex items-center gap-2 rounded-[5px] border-2 border-dashed border-foreground/40 bg-muted/30 px-3 py-2 text-xs font-bold">
                {t(
                  "All records in this system are synthetic. No real case or person appears in it.",
                )}
              </p>
            </header>

            {chapters.map((chapter, ci) => (
              <article key={chapter.id} className="mt-16 scroll-mt-28">
                <div className="font-mono text-xs font-bold uppercase tracking-[0.18em] text-foreground/45">
                  {t("Chapter")} {["I", "II", "III", "IV", "V"][ci]}
                </div>
                <h2 className="mt-2 text-3xl font-extrabold tracking-tight md:text-4xl">
                  {chapter.title}
                </h2>
                {chapter.lede.map((p) => (
                  <p
                    key={p}
                    className="mt-4 max-w-3xl text-base leading-relaxed text-foreground/80"
                  >
                    {p}
                  </p>
                ))}

                {chapter.sections.map((section) => (
                  <section key={section.id} id={section.id} className="mt-12 scroll-mt-28">
                    <h3 className="text-xl font-extrabold tracking-tight">{section.heading}</h3>
                    <div className="mt-4 max-w-3xl space-y-4">
                      {section.blocks.map((block, bi) => (
                        <BlockView key={bi} block={block} />
                      ))}
                    </div>
                  </section>
                ))}
              </article>
            ))}

            <NB className="mt-20 flex flex-wrap items-center justify-between gap-4 p-6">
              <div>
                <h2 className="text-lg font-extrabold tracking-tight">{t("See it running")}</h2>
                <p className="mt-1 text-sm text-foreground/70">
                  {t("Open the console and ask it something in English or Kannada.")}
                </p>
              </div>
              <a
                href="/login"
                className="inline-flex items-center gap-2 rounded-[5px] border-2 border-foreground bg-primary px-4 py-2 text-sm font-extrabold text-primary-foreground nb-shadow transition hover:translate-x-[3px] hover:translate-y-[3px]"
              >
                {t("Sign in")}
                <ArrowRight className="h-4 w-4" strokeWidth={2.5} />
              </a>
            </NB>
          </main>
        </div>
      </div>

      <Footer />
    </div>
  );
}

function BlockView({ block }: { block: Block }) {
  switch (block.kind) {
    case "p":
      return <p className="text-base leading-relaxed text-foreground/80">{block.text}</p>;

    case "note":
      return (
        <NB className="p-4">
          <div className="flex items-start gap-2">
            <ExternalLink className="mt-0.5 h-4 w-4 shrink-0 text-primary" strokeWidth={2.5} />
            <div className="min-w-0">
              <div className="text-sm font-extrabold tracking-tight">{block.title}</div>
              <p className="mt-1.5 text-sm leading-relaxed text-foreground/75">{block.text}</p>
            </div>
          </div>
        </NB>
      );

    case "list":
      return (
        <ul className="space-y-2.5">
          {block.items.map((item) => (
            <li key={item} className="flex gap-2.5 text-base leading-relaxed text-foreground/80">
              <span
                aria-hidden="true"
                className="mt-[0.55rem] h-1.5 w-1.5 shrink-0 rounded-full bg-primary ring-2 ring-foreground"
              />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      );

    case "steps":
      return (
        <ol className="space-y-3">
          {block.items.map((item, i) => (
            <li key={item.label} className="flex gap-3">
              <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-[4px] border-2 border-foreground bg-secondary-background text-[10px] font-black nb-shadow-sm">
                {i + 1}
              </span>
              <div className="min-w-0">
                <span className="font-mono text-sm font-bold text-foreground">{item.label}</span>
                <p className="mt-1 text-[15px] leading-relaxed text-foreground/75">{item.text}</p>
              </div>
            </li>
          ))}
        </ol>
      );

    case "table":
      return (
        <NB className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b-2 border-foreground bg-muted/40">
                  {block.head.map((h) => (
                    <th
                      key={h}
                      className="px-3.5 py-2.5 text-[11px] font-extrabold uppercase tracking-wider"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.rows.map((row) => (
                  <tr key={row.join("|")} className="border-b border-foreground/12 last:border-0">
                    {row.map((cell, i) => (
                      <td
                        key={i}
                        className={
                          i === 0
                            ? "px-3.5 py-2.5 font-bold text-foreground"
                            : "px-3.5 py-2.5 text-foreground/75"
                        }
                      >
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </NB>
      );
  }
}
