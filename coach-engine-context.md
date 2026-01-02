{\rtf1\ansi\ansicpg1250\cocoartf2867
\cocoatextscaling0\cocoaplatform0{\fonttbl\f0\fswiss\fcharset0 Helvetica;}
{\colortbl;\red255\green255\blue255;}
{\*\expandedcolortbl;;}
\paperw11900\paperh16840\margl1440\margr1440\vieww28600\viewh16040\viewkind0
\pard\tx720\tx1440\tx2160\tx2880\tx3600\tx4320\tx5040\tx5760\tx6480\tx7200\tx7920\tx8640\pardirnatural\partightenfactor0

\f0\fs24 \cf0 # Coach Question Engine \'96 Context & Architecture (MVP)\
\
## Purpose\
This document describes the architecture, constraints, and decisions for the **Question Engine** used in an open, facilitator-like workshop application.\
\
The goal is NOT to run a questionnaire.\
The goal IS to support free thinking on a board, and provide **one well-timed question** only when the user asks for help or gets stuck.\
\
The engine must feel like a thinking companion, not a process.\
\
---\
\
## Core Concept (Non-negotiable)\
- User works on a **free board** with:\
  - ideas\
  - observations\
  - doubts\
  - questions\
- No visible steps, categories, or matrices in the UI.\
- The system tracks **context gravity** internally.\
- Questions are **suggested only on demand** ("Give me an impulse").\
\
Questions are help, not a workflow.\
\
---\
\
## MVP Technical Decisions (LOCKED)\
- Database: **SQLite** (MVP only)\
- Backend: Node.js / TypeScript\
- No external LLM\
- No embeddings (yet)\
- Question selection based on:\
  - metadata\
  - session rhythm\
  - simple scoring\
- Future migration to Postgres must be easy (schema-compatible).\
\
---\
\
## Question Corpus (Source of Truth)\
Questions are stored as structured data with metadata.\
\
Each question has:\
- group: A | B | C\
- mode: 1 | 2 | 3\
- category: domain dimension (USER, USAGE, TECHNOLOGY, etc.)\
- intent: why this question exists (unlock, assumption check, feasibility\'85)\
- difficulty: 1\'965\
- priority: 1\'96100\
- tags: lightweight semantic hints\
\
Questions are NEVER shown as a list.\
Only ONE question is suggested at a time.\
\
---\
\
## Question Groups (Semantic Meaning)\
- Group A: World / Context\
- Group B: Product / System\
- Group C: Elements / Feasibility (includes TECHNOLOGY as a strong category)\
\
Modes:\
- 1: how it is\
- 2: what doesn\'92t work\
- 3: how it should be\
\
---\
\
## SQLite Schema (MVP)\
\
### questions\
- id (TEXT, PK)\
- text\
- group_code (A/B/C)\
- mode_code (1/2/3)\
- category_code\
- intent_code\
- difficulty (1\'965)\
- priority (default 50)\
- is_active (bool)\
- lang (default 'pl')\
\
### question_tags\
- question_id\
- tag\
\
### sessions\
- id\
- created_at\
- updated_at\
- last_group_code\
- last_mode_code\
- last_category_code\
- stuck_counter\
\
### board_items\
- id\
- session_id\
- type (idea | observation | doubt | question)\
- text\
- created_at\
\
### asked_questions\
- session_id\
- question_id\
- asked_at\
\
SQLite MUST be configured with:\
- WAL mode\
- busy_timeout\
- foreign_keys ON\
\
---\
\
## Engine Responsibilities\
\
### The engine MUST:\
- suggest only ONE question per request\
- avoid repeating questions in a session\
- avoid jumping across too many dimensions at once\
- respect rhythm (stay near last cognitive position)\
- prioritize relevance to current board context\
\
### The engine MUST NOT:\
- auto-push questions\
- show process steps\
- explain methodology\
- flood the user with options\
\
---\
\
## Session Rhythm Rules (Simplified)\
1. Never change more than ONE dimension at once:\
   - group OR mode OR category\
2. Penalize large jumps (A <-> C).\
3. Prefer continuity unless user is clearly stuck.\
4. When stuck_counter increases \uc0\u8594  lower difficulty.\
\
---\
\
## Scoring Logic (MVP \'96 no AI)\
\
Final score =  \
- relevance_to_board  \
- novelty_bonus  \
- rhythm_fit  \
- gap_bonus  \
- priority_weight  \
- penalties (repetition, jump, fatigue)\
\
Relevance is based on:\
- tag overlap\
- simple keyword matching\
\
---\
\
## API Responsibility (Example)\
POST /coach/suggest\
\
Input:\
- session_id\
- recent board_items\
- session_state\
\
Output:\
- exactly one question OR null\
\
---\
\
## UX Contract (Important)\
- Question is shown as a **suggestion**, not a task.\
- User can:\
  - add it to the board\
  - ask for a different impulse\
  - ignore it completely\
\
Ignoring a question must NOT break the flow.\
\
---\
\
## Future (Explicitly NOT MVP)\
- embeddings-based relevance\
- LLM conversational layer\
- analytics-driven prioritization\
- multi-language generation\
- collaborative boards\
\
---\
\
## TODO for Codex\
1. Implement SQLite schema + initialization (WAL, timeout).\
2. Implement QuestionRepository (load questions + tags).\
3. Implement SessionRepository (state + asked questions).\
4. Implement suggestNextQuestion(board, session).\
5. Add API endpoint returning ONE question.\
6. Write minimal tests for scoring and rhythm rules.\
\
---\
\
## Design Principle to Remember\
"If the user notices the method, we failed.\
If the user feels supported while thinking, we succeeded."\
}