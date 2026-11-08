import * as sdk from "@kirocrew/app-sdk";
import { activeLocale, useAppApi, useChatLauncher, useImeGuard, useLanguageGeneration } from "@kirocrew/app-sdk";
import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Brain, Check, ChevronDown, ChevronRight, ExternalLink, FolderGit2, GitBranch, GitCommitVertical, GitPullRequest, Loader2, MessageSquare, Minus, Play, RefreshCw, Ruler, Square, X } from "lucide-react";
import * as ui from "@kirocrew/app-sdk/ui";
import { Badge, Btn, Card, CardTitle, Clickable, Input, StatCard } from "@kirocrew/app-sdk/ui";
import { jsx, jsxs } from "react/jsx-runtime";
// src/api.ts
var API = "/api/apps/auto-improvement";
/** Before the root mounts (a module evaluated early): a plain same-origin fetch. */
var sameOriginFetch = { async raw(path, init) {
	const r = await fetch(path, {
		credentials: "same-origin",
		...init
	});
	if (!r.ok) {
		const text = await r.text().catch(() => r.statusText);
		throw Object.assign(/* @__PURE__ */ new Error(`API ${r.status}: ${text}`), {
			status: r.status,
			body: text
		});
	}
	return r;
} };
var transport = sameOriginFetch;
/** Route every call through *next* (the page root passes `useAppApi()`). */
function setTransport(next) {
	transport = next ?? sameOriginFetch;
}
/** A refused call: the HTTP status, the backend's `error` sentence and its raw body. */
var ApiError = class extends Error {
	status;
	body;
	constructor(status, message, body) {
		super(message);
		this.name = "ApiError";
		this.status = status;
		this.body = body;
	}
};
function backendMessage(status, body) {
	try {
		const parsed = JSON.parse(body);
		if (parsed && typeof parsed === "object") {
			const error = parsed.error;
			if (typeof error === "string" && error) return error;
		}
	} catch {}
	return body.trim() || `HTTP ${status}`;
}
/** The scoped client's refusal as an `ApiError`; anything else passes through. */
function toApiError(err) {
	if (err && typeof err === "object" && "status" in err && typeof err.status === "number") {
		const status = err.status;
		const raw = err.body;
		const body = typeof raw === "string" ? raw : "";
		return new ApiError(status, backendMessage(status, body), body);
	}
	return err;
}
/** One request through the scoped client; a refusal is rethrown as an `ApiError`. */
async function request(path, init) {
	try {
		return await transport.raw(path, {
			credentials: "same-origin",
			...init
		});
	} catch (err) {
		throw toApiError(err);
	}
}
/** A JSON body, or `{}` for a 204 (a body-less success, such as a DELETE). */
async function readJson(r) {
	if (r.status === 204) return {};
	return await r.json();
}
async function getJson(path) {
	return readJson(await request(path));
}
async function sendJson(method, path, body) {
	const init = { method };
	if (body !== void 0) {
		init.headers = { "Content-Type": "application/json" };
		init.body = JSON.stringify(body);
	}
	return readJson(await request(path, init));
}
/**
* The body of a refused call, parsed, when it is a JSON object; `{}` otherwise.
*
* The built-in page read `{code, error}` off a non-2xx response itself (a 409 from
* a run already in progress, a 400 from a refused clone). Through the scoped client
* a non-2xx is an `ApiError`, whose raw body this reads back.
*/
function refusalBody(err) {
	const body = err instanceof ApiError ? err.body : "";
	try {
		const parsed = JSON.parse(body);
		return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
	} catch {
		return {};
	}
}
// src/i18n.ts
/**
* The app's own strings. A bundle cannot read the dashboard's catalogs (those
* belong to the host and change with it), so every locale the dashboard ships is
* bundled here and looked up against the host's active language.
*
* The catalogs (`ui/i18n/<locale>.json`) are the `apps.autoImprovement.*` and
* `autoImprovement.*` subtrees copied from Kiro Crew's dashboard catalogs (for
* English, its generated and hand-authored catalogs merged), plus the one dashboard
* string the seeder shows (`pages.chatPage.could_not_start_a_new_session`), under
* the SAME key paths, so every call site reads as it did in the built-in.
*
* Lookup order: the exact locale (`pt`, `zh-CN`), then its base language, then
* English, then the key itself. A numeric `count` selects the plural form the
* locale's rules name (`_one`, `_few`, `_many`, `_other`), as the dashboard's own
* catalogs are keyed. `{{name}}` placeholders are filled from `vars`; one with no
* value is left as written.
*
* `t` reads the language at call time. The root component subscribes to the
* host's language changes (`useLanguageGeneration`), and its re-render reaches
* every child, so a language switch repaints the page without a reload.
*/
var CATALOGS = {
	bn: {
		apps: { "autoImprovement": {
			"findingDetail": {
				"build": "বিল্ড",
				"collects": "সংগ্রহ",
				"green": "GREEN",
				"lint": "লিন্ট",
				"red": "RED",
				"staygreen": "STAYGREEN"
			},
			"manifest": {
				"description": "কোনো GitHub রিপোজিটরি বদলানোর আগে তা মেপে নেয়। একটি ক্যালিব্রেট করা পারফরম্যান্স মেট্রিক (মাপকাঠি) তৈরি করে, জানা একটি উন্নতির বিপরীতে প্রমাণ করে যে মেট্রিকটি নির্ভরযোগ্য, তারপর রাখা-বা-ফিরিয়ে-নেওয়ার উন্নতিচক্র চালায়: প্রতিটি সম্ভাব্য সংশোধন আলাদা worktree-তে লেখা হয়, সম্পাদনের অনুমোদিত তালিকা ও রিপোজিটরির নিজস্ব পরীক্ষার মধ্য দিয়ে যায়, এবং কেবল তখনই রাখা হয় যখন মাপা লাভ নয়েজ-ব্যান্ড ছাড়িয়ে যায়। ডিফল্টভাবে, টিকে যাওয়া সংশোধনগুলো GitHub পুল রিকোয়েস্টের খসড়া হিসেবে তৈরি হয়, যা তুমি নিজে দেখে প্রকাশ করো।",
				"display_name": "Auto-Improvement",
				"use_case_1": "সফল বিকল্পগুলোকে পর্যালোচনাযোগ্য GitHub পরিবর্তনে রূপ দেওয়ার আগে পরিমাপযোগ্য কর্মদক্ষতার উন্নতি বা পুনরুৎপাদনযোগ্য bug fix প্রমাণ করুন।",
				"configuration_1": "গেটওয়ে হোস্টে git ও প্রমাণীকৃত gh CLI থাকতে হবে; একটি GitHub রিপোজিটরি সংযুক্ত করুন, তার base branch বেছে নিন এবং performance run-এর আগে ruler calibrate করুন।",
				"highlight_1": "আগে নিজের মাপকাঠিই প্রমাণ করে — অবিশ্বস্ত মাপকাঠিতে রান শুরুই হয় না",
				"highlight_2": "প্রতিটি প্রার্থী A/B-তে মাপা হয়, বাগ সংশোধনে RED/GREEN — শুধু «দেখে ঠিক লাগছে» নয়",
				"highlight_3": "লাভ মাপা নয়েজ-ব্যান্ড ছাড়ালেই কেবল পরিবর্তন রাখা হয়",
				"highlight_4": "GitHub পুল রিকোয়েস্ট তৈরি করে — কেবল খসড়া, আপনার হয়ে কখনও প্রকাশ বা মার্জ নয়",
				"highlight_5": "push-বিহীন ক্লোনে চলে, তাই পর্যালোচনা ছাড়া কিছুই স্যান্ডবক্স ছাড়ে না",
				"highlight_6": "প্রতিটি পুল রিকোয়েস্ট, ফলাফল ও রানের জন্য একটি পুনরারম্ভযোগ্য চ্যাট সেশন",
				"page_label": "Auto-Improve"
			},
			"setupPanel": { "https_github_com_owner_repo": "https://github.com/owner/repo" }
		} },
		autoImprovement: {
			"activityDiscovered": "(আবিষ্কৃত {{discovered}}, নতুন {{fresh}})",
			"autocommitHint": "প্রতিটি যাচাই করা পরিবর্তন সরাসরি বেস ব্রাঞ্চে পুশ করুন। সুরক্ষিত ব্রাঞ্চ সবসময় খসড়া পুল রিকোয়েস্টে ফিরে যায়।",
			"autocommitLabel": "সরাসরি ব্রাঞ্চে কমিট করুন (কোনো পুল রিকোয়েস্ট নয়)",
			"band": "ব্যান্ড",
			"base": "ভিত্তি",
			"branchDefault": "রিপোজিটরি ডিফল্ট",
			"branchLabel": "বেস ব্রাঞ্চ",
			"calibrated": "ক্যালিব্রেট করা",
			"changesHeading": "খসড়া পুল রিকোয়েস্ট",
			"cloneBtn": "সংযুক্ত করুন",
			"colActions": "ক্রিয়া",
			"colChange": "পরিবর্তন",
			"colChecks": "পরীক্ষা",
			"colPr": "পুল রিকোয়েস্ট",
			"colVerdict": "অবস্থা",
			"commitConfirm": "এই পরিবর্তন “{{branch}}”-এ কমিট করে পুশ করবেন? প্রকাশিত কমিট ফিরিয়ে নেওয়া যায় না।",
			"commitFailed": "কমিট প্রত্যাখ্যান করা হয়েছে।",
			"commitFinding": "ব্রাঞ্চে কমিট করুন",
			"currentRepo": "কাজ চলছে",
			"cycle": "চক্র",
			"defectHeading": "ত্রুটি",
			"delta": "মাপা পার্থক্য",
			"detailUnavailable": "এই প্রাপ্তির জন্য বিবরণ নেই।",
			"discussFinding": "এই প্রাপ্তি নিয়ে আলোচনা করুন",
			"discussPr": "এই পুল রিকোয়েস্ট নিয়ে আলোচনা করুন",
			"discussRuler": "মাপনী নিয়ে আলোচনা করুন",
			"draftPr": "খসড়া",
			"findingTitlePrefix": "প্রাপ্তি",
			"findingsHeading": "প্রাপ্তির খাতা",
			"findingsStat": "প্রাপ্তি",
			"findingsTruncated": "{{total}}টি প্রাপ্তির মধ্যে সাম্প্রতিক {{shown}}টি দেখানো হচ্ছে।",
			"fingerprint": "ফিঙ্গারপ্রিন্ট",
			"gateHeading": "যাচাই ধাপ",
			"gateNote": "ধাপের নোট",
			"historyHeading": "অবস্থার ইতিহাস",
			"hypothesisHeading": "পুনরুৎপাদন অনুমান",
			"idleStatus": "নিষ্ক্রিয় — উন্নতি খুঁজতে এবং পুল রিকোয়েস্ট তৈরি করতে একটি রান শুরু করুন।",
			"intro": "একটি রিপোজিটরির বাগ ঠিক করে এবং কেবল সেই সমাধানই রাখে যা তার টেস্ট প্রমাণ করে: প্রতিটি সমাধানকে একটি ব্যর্থ টেস্ট পাস করাতে হয়, বাকিগুলো না ভেঙে, আর টিকে থাকা সমাধানগুলো খসড়া পুল রিকোয়েস্ট হয়ে আপনার পর্যালোচনার জন্য আসে।",
			"keptStat": "রাখা হয়েছে",
			"loadingDetail": "বিবরণ লোড হচ্ছে…",
			"noFindings": "এখনও কোনো প্রাপ্তি নথিভুক্ত হয়নি।",
			"noPrs": "এখনও কোনো পুল রিকোয়েস্ট তৈরি হয়নি।",
			"prStat": "পুল রিকোয়েস্ট",
			"prTitlePrefix": "পিআর",
			"pushDisabled": "পুশ নিষ্ক্রিয়",
			"queuedOnly": "স্থানীয়ভাবে সারিবদ্ধ, খোলা হয়নি",
			"refreshPr": "পুল রিকোয়েস্টের অবস্থা রিফ্রেশ করুন",
			"regressed": "ক্ষতিগ্রস্ত পরীক্ষা: {{tests}}",
			"repoLabel": "উন্নত করার জন্য GitHub রিপোজিটরি",
			"reproTest": "পুনরুৎপাদন পরীক্ষা",
			"rulerHeading": "মাপনী",
			"rulerNotReady": "মাপনী এখনও ক্যালিব্রেট করা হয়নি। এটি শুধু গতি বৃদ্ধি যাচাই করতে ব্যবহৃত হয়; এই পৃষ্ঠা থেকে শুরু করা রানগুলো বাগ ঠিক করে, আর প্রতিটি সমাধান যাচাই করে রিপোজিটরির নিজস্ব টেস্ট।",
			"rulerReady": "মাপনী ক্যালিব্রেট ও প্রস্তুত",
			"rulerSessionTitle": "মাপনী পর্যালোচনা",
			"rulerStat": "মাপনী",
			"runBtn": "রান শুরু করুন",
			"runError": "রান একটি ত্রুটি নিয়ে থেমে গেছে।",
			"runningStatus": "চলছে — চক্র {{cycle}}, {{kept}} রাখা হয়েছে, {{drafted}} পুল রিকোয়েস্ট তৈরি।",
			"setupHeading": "রিপোজিটরি",
			"showDiff": "পরিবর্তন দেখুন",
			"showPrBody": "পুল রিকোয়েস্টের বিবরণ দেখুন",
			"statusCommitted": "ব্রাঞ্চে কমিট হয়েছে",
			"statusDiscardedNoise": "নয়েজ ব্যান্ডের নিচে",
			"statusDuplicate": "সদৃশ",
			"statusError": "টুলিং ত্রুটি",
			"statusFailedGate": "গেট প্রত্যাখ্যান করেছে",
			"statusFailedVerify": "সংশোধন যাচাই হয়নি",
			"statusFiled": "পুল রিকোয়েস্টের খসড়া হয়েছে",
			"statusNoDefect": "কোনো ত্রুটি পাওয়া যায়নি",
			"statusPurged": "অপারেটর মুছে দিয়েছেন",
			"statusSeen": "দেখা হয়েছে",
			"statusUnavailable": "অনুপলব্ধ",
			"stopBtn": "রান থামান",
			"title": "স্বয়ংক্রিয় উন্নতি",
			"toggleDetail": "প্রাপ্তির বিবরণ দেখান",
			"truncated": "সংক্ষিপ্ত",
			"uncalibrated": "ক্যালিব্রেট করা নয়",
			"viewCommit": "কমিট দেখুন",
			"viewPr": "পুল রিকোয়েস্ট"
		},
		pages: { "chatPage": { "could_not_start_a_new_session": "নতুন সেশন শুরু করা যায়নি" } }
	},
	de: {
		apps: { "autoImprovement": {
			"findingDetail": {
				"build": "Build",
				"collects": "erfasst",
				"green": "GREEN",
				"lint": "Lint",
				"red": "RED",
				"staygreen": "STAYGREEN"
			},
			"manifest": {
				"description": "Misst ein GitHub-Repository, bevor es daran etwas ändert. Entwirft eine kalibrierte Leistungsmetrik (das Maß), weist anhand eines bekannten Gewinns nach, dass die Metrik vertrauenswürdig ist, und führt dann Verbessern-oder-Verwerfen-Zyklen aus: Jede Kandidatenkorrektur entsteht in einem isolierten Worktree, wird gegen eine Bearbeitungs-Allowlist und die Tests des Repositorys geprüft und nur behalten, wenn der gemessene Gewinn das Rauschband übersteigt. Standardmäßig wird, was übrig bleibt, als GitHub-Pull-Request im Entwurfsstatus angelegt, den du selbst prüfst und veröffentlichst.",
				"display_name": "Auto-Improvement",
				"highlight_1": "Weist zuerst die eigene Metrik nach — ein Lauf startet nicht mit einem unzuverlässigen Maß",
				"highlight_2": "Jeder Kandidat wird A/B gemessen, bei Fehlerkorrekturen RED/GREEN, niemals nur „sieht richtig aus“",
				"highlight_3": "Behält eine Änderung nur, wenn der Gewinn das gemessene Rauschband übersteigt",
				"highlight_4": "Legt GitHub-Pull-Requests an — nur als Entwurf, niemals für dich veröffentlicht oder gemergt",
				"highlight_5": "Arbeitet auf einem Klon ohne Push-Recht, damit nichts ungeprüft die Sandbox verlässt",
				"highlight_6": "Eine fortsetzbare Chat-Sitzung pro Pull Request, Befund und Lauf",
				"page_label": "Auto-Improve",
				"use_case_1": "Belege messbare Leistungssteigerungen oder reproduzierbare Fehlerkorrekturen, bevor erfolgreiche Kandidaten zu überprüfbaren GitHub-Änderungen werden.",
				"configuration_1": "Auf dem Gateway-Host werden Git und eine authentifizierte gh-CLI benötigt; verbinde ein GitHub-Repository, wähle den Basis-Branch und kalibriere vor Leistungsläufen eine Messgröße."
			},
			"setupPanel": { "https_github_com_owner_repo": "https://github.com/owner/repo" }
		} },
		autoImprovement: {
			"activityDiscovered": "(gefunden {{discovered}}, neu {{fresh}})",
			"autocommitHint": "Jede geprüfte Änderung direkt in den Basis-Branch pushen. Geschützte Branches fallen immer auf einen Pull-Request-Entwurf zurück.",
			"autocommitLabel": "Direkt in den Branch committen (kein Pull Request)",
			"band": "Rauschband",
			"base": "Basis",
			"branchDefault": "Repository-Standard",
			"branchLabel": "Basis-Branch",
			"calibrated": "Kalibriert",
			"changesHeading": "Pull-Request-Entwürfe",
			"cloneBtn": "Verbinden",
			"colActions": "Aktionen",
			"colChange": "Änderung",
			"colChecks": "Prüfungen",
			"colPr": "Pull Request",
			"colVerdict": "Status",
			"commitConfirm": "Diese Änderung nach „{{branch}}“ committen und pushen? Ein veröffentlichter Commit lässt sich nicht zurückrufen.",
			"commitFailed": "Der Commit wurde abgelehnt.",
			"commitFinding": "In den Branch committen",
			"currentRepo": "Bearbeitet",
			"cycle": "Zyklus",
			"defectHeading": "Defekt",
			"delta": "Gemessene Differenz",
			"detailUnavailable": "Für diesen Befund sind keine Details verfügbar.",
			"discussFinding": "Diesen Befund besprechen",
			"discussPr": "Diesen Pull Request besprechen",
			"discussRuler": "Den Maßstab besprechen",
			"draftPr": "Entwurf",
			"findingTitlePrefix": "Befund",
			"findingsHeading": "Befundverzeichnis",
			"findingsStat": "Befunde",
			"findingsTruncated": "Es werden die {{shown}} neuesten von {{total}} Befunden angezeigt.",
			"fingerprint": "Fingerprint",
			"gateHeading": "Prüfungen",
			"gateNote": "Prüfungshinweis",
			"historyHeading": "Statusverlauf",
			"hypothesisHeading": "Reproduktionshypothese",
			"idleStatus": "Inaktiv — starten Sie einen Lauf, um Verbesserungen zu finden und Pull Requests zu erstellen.",
			"intro": "Behebt Fehler in einem Repository und behält nur, was seine Tests belegen: Jede Korrektur muss einen fehlschlagenden Test grün machen, ohne den Rest zu brechen, und was besteht, wird zu Entwurfs-Pull-Requests, die Sie prüfen.",
			"keptStat": "Behalten",
			"loadingDetail": "Details werden geladen…",
			"noFindings": "Noch keine Befunde erfasst.",
			"noPrs": "Noch keine Pull Requests erstellt.",
			"prStat": "Pull Requests",
			"prTitlePrefix": "PR",
			"pushDisabled": "Push deaktiviert",
			"queuedOnly": "lokal eingereiht, nicht eröffnet",
			"refreshPr": "Pull-Request-Status aktualisieren",
			"regressed": "Regressierte Tests: {{tests}}",
			"repoLabel": "Zu verbesserndes GitHub-Repository",
			"reproTest": "Reproduktionstest",
			"rulerHeading": "Der Maßstab",
			"rulerNotReady": "Der Maßstab ist noch nicht kalibriert. Er bewertet nur Beschleunigungen; die Läufe, die auf dieser Seite gestartet werden, beheben Fehler, und jede Korrektur wird stattdessen von den Tests des Repositorys bewertet.",
			"rulerReady": "Maßstab kalibriert und bereit",
			"rulerSessionTitle": "Maßstab-Review",
			"rulerStat": "Maßstab",
			"runBtn": "Lauf starten",
			"runError": "Der Lauf wurde mit einem Fehler beendet.",
			"runningStatus": "Läuft — Zyklus {{cycle}}, {{kept}} behalten, {{drafted}} Pull Requests erstellt.",
			"setupHeading": "Repository",
			"showDiff": "Änderung anzeigen",
			"showPrBody": "Pull-Request-Beschreibung anzeigen",
			"statusCommitted": "In den Branch committet",
			"statusDiscardedNoise": "Unterhalb des Rauschbands",
			"statusDuplicate": "Duplikat",
			"statusError": "Werkzeugfehler",
			"statusFailedGate": "Vom Gate abgelehnt",
			"statusFailedVerify": "Fix nicht verifiziert",
			"statusFiled": "Pull Request als Entwurf",
			"statusNoDefect": "Kein Defekt gefunden",
			"statusPurged": "Vom Betreiber gelöscht",
			"statusSeen": "Gesehen",
			"statusUnavailable": "Nicht verfügbar",
			"stopBtn": "Lauf stoppen",
			"title": "Selbstverbesserung",
			"toggleDetail": "Befunddetails anzeigen",
			"truncated": "gekürzt",
			"uncalibrated": "Nicht kalibriert",
			"viewCommit": "Commit ansehen",
			"viewPr": "Pull Request"
		},
		pages: { "chatPage": { "could_not_start_a_new_session": "Neue Sitzung konnte nicht gestartet werden" } }
	},
	en: {
		apps: { "autoImprovement": {
			"findingDetail": {
				"build": "build",
				"collects": "collects",
				"green": "GREEN",
				"lint": "lint",
				"red": "RED",
				"staygreen": "STAYGREEN"
			},
			"manifest": {
				"description": "Measures a GitHub repository before it changes it. Designs a calibrated performance metric (the ruler), proves the metric is trustworthy against a known win, then runs keep-or-revert improvement cycles: every candidate fix is written in an isolated worktree, gated against an edit allowlist and the repo's own tests, and kept only when the measured win clears the noise band. By default, survivors are drafted as GitHub pull requests you review and publish yourself.",
				"display_name": "Auto-Improvement",
				"highlight_1": "Proves its own metric first — a run refuses to start on an untrustworthy ruler",
				"highlight_2": "Every candidate is measured A/B, or RED/GREEN for bug fixes, never just 'looks right'",
				"highlight_3": "Keeps a change only when the win clears the measured noise band",
				"highlight_4": "Drafts GitHub pull requests — draft-only, never published or merged for you",
				"highlight_5": "Works on a push-disabled clone, so nothing escapes the sandbox unreviewed",
				"highlight_6": "One resumable chat session per pull request, finding, and run",
				"page_label": "Auto-Improve",
				"use_case_1": "Prove measurable performance gains or reproducible bug fixes before turning survivors into reviewable GitHub changes.",
				"configuration_1": "The gateway host needs git and an authenticated gh CLI; connect a GitHub repository, choose its base branch, and calibrate a ruler before performance runs."
			},
			"setupPanel": { "https_github_com_owner_repo": "https://github.com/owner/repo" }
		} },
		autoImprovement: {
			"activityDiscovered": "(discovered {{discovered}}, fresh {{fresh}})",
			"autocommitHint": "Push each verified change straight to the base branch. Protected branches always fall back to a draft PR.",
			"autocommitLabel": "Commit directly to the branch (no pull request)",
			"band": "band",
			"base": "Base",
			"branchDefault": "Repository default",
			"branchLabel": "Base branch",
			"calibrated": "Calibrated",
			"changesHeading": "Draft pull requests",
			"cloneBtn": "Connect",
			"colActions": "Actions",
			"colChange": "Change",
			"colChecks": "Checks",
			"colPr": "Pull request",
			"colVerdict": "State",
			"commitConfirm": "Commit this change to “{{branch}}” and push it? A published commit cannot be recalled.",
			"commitFailed": "The commit was refused.",
			"commitFinding": "Commit to the branch",
			"currentRepo": "Working on",
			"cycle": "Cycle",
			"defectHeading": "Defect",
			"delta": "Measured delta",
			"detailUnavailable": "Details are unavailable for this finding.",
			"discussFinding": "Discuss this finding",
			"discussPr": "Discuss this pull request",
			"discussRuler": "Discuss the ruler",
			"draftPr": "Draft",
			"findingTitlePrefix": "Finding",
			"findingsHeading": "Findings ledger",
			"findingsStat": "Findings",
			"findingsTruncated": "Showing the {{shown}} most recent of {{total}} findings.",
			"fingerprint": "Fingerprint",
			"gateHeading": "Verification gates",
			"gateNote": "Gate note",
			"historyHeading": "Status history",
			"hypothesisHeading": "Reproduction hypothesis",
			"idleStatus": "Idle — start a run to find improvements and draft pull requests.",
			"intro": "Fixes bugs in a repository and keeps only what its tests prove: each fix must turn a failing test green without breaking the rest, and survivors become draft pull requests you review.",
			"keptStat": "Kept",
			"loadingDetail": "Loading details…",
			"noFindings": "No findings recorded yet.",
			"noPrs": "No pull requests drafted yet.",
			"prStat": "Pull requests",
			"prTitlePrefix": "PR",
			"pushDisabled": "push disabled",
			"queuedOnly": "queued locally, not opened",
			"refreshPr": "Refresh pull request status",
			"regressed": "Regressed tests: {{tests}}",
			"repoLabel": "GitHub repository to improve",
			"reproTest": "Repro test",
			"rulerHeading": "The ruler",
			"rulerNotReady": "The ruler is not calibrated yet. It is only used to judge speed-ups; the runs started from this page fix bugs, and the repository's tests judge each fix instead.",
			"rulerReady": "Ruler calibrated and ready",
			"rulerSessionTitle": "Ruler review",
			"rulerStat": "Ruler",
			"runBtn": "Start run",
			"runError": "The run stopped with an error.",
			"runningStatus": "Running — cycle {{cycle}}, {{kept}} kept, {{drafted}} pull requests drafted.",
			"setupHeading": "Repository",
			"showDiff": "Show the change",
			"showPrBody": "Show the pull request description",
			"statusCommitted": "Committed to the branch",
			"statusDiscardedNoise": "Below the noise band",
			"statusDuplicate": "Duplicate",
			"statusError": "Tooling error",
			"statusFailedGate": "Rejected by the gate",
			"statusFailedVerify": "Fix did not verify",
			"statusFiled": "Pull request drafted",
			"statusNoDefect": "No defect found",
			"statusPurged": "Deleted by the operator",
			"statusSeen": "Seen",
			"statusUnavailable": "Unavailable",
			"stopBtn": "Stop run",
			"title": "Auto-Improvement",
			"toggleDetail": "Show finding details",
			"truncated": "truncated",
			"uncalibrated": "Not calibrated",
			"viewCommit": "View commit",
			"viewPr": "Pull request"
		},
		pages: { "chatPage": { "could_not_start_a_new_session": "Could not start a new session" } }
	},
	es: {
		apps: { "autoImprovement": {
			"findingDetail": {
				"build": "compilación",
				"collects": "recopila",
				"green": "GREEN",
				"lint": "lint",
				"red": "RED",
				"staygreen": "STAYGREEN"
			},
			"manifest": {
				"description": "Mide un repositorio de GitHub antes de cambiarlo. Diseña una métrica de rendimiento calibrada (la regla), demuestra que la métrica es fiable frente a una mejora conocida y luego ejecuta ciclos de conservar o revertir: cada corrección candidata se escribe en un worktree aislado, se filtra con una lista de permitidos de edición y las pruebas del propio repositorio, y solo se conserva cuando la mejora medida supera la banda de ruido. De forma predeterminada, las supervivientes se redactan como pull requests de GitHub en borrador que tú revisas y publicas.",
				"display_name": "Auto-Improvement",
				"highlight_1": "Primero demuestra su propia métrica: una ejecución se niega a empezar con una regla poco fiable",
				"highlight_2": "Cada candidato se mide en A/B, o RED/GREEN para correcciones de errores, nunca solo “parece correcto”",
				"highlight_3": "Conserva un cambio solo cuando la mejora supera la banda de ruido medida",
				"highlight_4": "Redacta pull requests de GitHub: solo borradores, nunca publicados ni fusionados por ti",
				"highlight_5": "Funciona sobre un clon sin permiso de push, así nada sale del entorno aislado sin revisión",
				"highlight_6": "Una sesión de chat reanudable por cada pull request, hallazgo y ejecución",
				"page_label": "Auto-Improve",
				"use_case_1": "Demuestra mejoras de rendimiento medibles o correcciones de errores reproducibles antes de convertir los candidatos válidos en cambios de GitHub listos para revisar.",
				"configuration_1": "El host del gateway necesita Git y la CLI gh autenticada; conecta un repositorio de GitHub, elige su rama base y calibra una medida antes de las pruebas de rendimiento."
			},
			"setupPanel": { "https_github_com_owner_repo": "https://github.com/owner/repo" }
		} },
		autoImprovement: {
			"activityDiscovered": "(descubiertos {{discovered}}, nuevos {{fresh}})",
			"autocommitHint": "Envía cada cambio verificado directamente a la rama base. Las ramas protegidas siempre recurren a un borrador de solicitud.",
			"autocommitLabel": "Confirmar directamente en la rama (sin solicitud de incorporación)",
			"band": "banda",
			"base": "Base",
			"branchDefault": "Predeterminada del repositorio",
			"branchLabel": "Rama base",
			"calibrated": "Calibrada",
			"changesHeading": "Borradores de solicitudes",
			"cloneBtn": "Conectar",
			"colActions": "Acciones",
			"colChange": "Cambio",
			"colChecks": "Comprobaciones",
			"colPr": "Solicitud",
			"colVerdict": "Estado",
			"commitConfirm": "¿Confirmar este cambio en “{{branch}}” y subirlo? Un commit publicado no se puede retirar.",
			"commitFailed": "El commit fue rechazado.",
			"commitFinding": "Confirmar en la rama",
			"currentRepo": "Trabajando en",
			"cycle": "Ciclo",
			"defectHeading": "Defecto",
			"delta": "Diferencia medida",
			"detailUnavailable": "No hay detalles disponibles para este hallazgo.",
			"discussFinding": "Comentar este hallazgo",
			"discussPr": "Comentar esta solicitud",
			"discussRuler": "Comentar la regla",
			"draftPr": "Borrador",
			"findingTitlePrefix": "Hallazgo",
			"findingsHeading": "Registro de hallazgos",
			"findingsStat": "Hallazgos",
			"findingsTruncated": "Se muestran los {{shown}} hallazgos más recientes de {{total}}.",
			"fingerprint": "Huella",
			"gateHeading": "Controles de verificación",
			"gateNote": "Nota del control",
			"historyHeading": "Historial de estados",
			"hypothesisHeading": "Hipótesis de reproducción",
			"idleStatus": "Inactivo — inicia una ejecución para encontrar mejoras y preparar solicitudes de incorporación.",
			"intro": "Corrige errores en un repositorio y conserva solo lo que sus pruebas demuestran: cada corrección debe hacer pasar una prueba que fallaba sin romper el resto, y lo que sobrevive se convierte en pull requests en borrador que usted revisa.",
			"keptStat": "Conservados",
			"loadingDetail": "Cargando detalles…",
			"noFindings": "Todavía no hay hallazgos registrados.",
			"noPrs": "Todavía no se ha preparado ninguna solicitud.",
			"prStat": "Solicitudes",
			"prTitlePrefix": "Solicitud",
			"pushDisabled": "envío deshabilitado",
			"queuedOnly": "en cola localmente, sin abrir",
			"refreshPr": "Actualizar el estado de la solicitud",
			"regressed": "Pruebas afectadas: {{tests}}",
			"repoLabel": "Repositorio de GitHub a mejorar",
			"reproTest": "Prueba de reproducción",
			"rulerHeading": "La regla",
			"rulerNotReady": "La regla aún no está calibrada. Solo se usa para valorar mejoras de velocidad; las ejecuciones que se inician desde esta página corrigen errores, y cada corrección la valoran las pruebas del repositorio.",
			"rulerReady": "Regla calibrada y lista",
			"rulerSessionTitle": "Revisión de la regla",
			"rulerStat": "Regla",
			"runBtn": "Iniciar ejecución",
			"runError": "La ejecución se detuvo con un error.",
			"runningStatus": "En ejecución — ciclo {{cycle}}, {{kept}} conservadas, {{drafted}} solicitudes preparadas.",
			"setupHeading": "Repositorio",
			"showDiff": "Ver el cambio",
			"showPrBody": "Ver la descripción de la solicitud",
			"statusCommitted": "Confirmado en la rama",
			"statusDiscardedNoise": "Por debajo de la banda de ruido",
			"statusDuplicate": "Duplicado",
			"statusError": "Error de herramientas",
			"statusFailedGate": "Rechazado por el control",
			"statusFailedVerify": "La corrección no se verificó",
			"statusFiled": "Pull request en borrador",
			"statusNoDefect": "No se encontró ningún defecto",
			"statusPurged": "Eliminado por el operador",
			"statusSeen": "Visto",
			"statusUnavailable": "No disponible",
			"stopBtn": "Detener ejecución",
			"title": "Automejora",
			"toggleDetail": "Mostrar detalles del hallazgo",
			"truncated": "truncado",
			"uncalibrated": "Sin calibrar",
			"viewCommit": "Ver commit",
			"viewPr": "Solicitud"
		},
		pages: { "chatPage": { "could_not_start_a_new_session": "No se pudo iniciar una sesión nueva" } }
	},
	fr: {
		apps: { "autoImprovement": {
			"findingDetail": {
				"build": "build",
				"collects": "collecte",
				"green": "GREEN",
				"lint": "lint",
				"red": "RED",
				"staygreen": "STAYGREEN"
			},
			"manifest": {
				"description": "Mesure un dépôt GitHub avant de le modifier. Conçoit une métrique de performance calibrée (la règle), prouve que la métrique est fiable face à un gain connu, puis exécute des cycles conserver-ou-annuler : chaque correctif candidat est écrit dans un worktree isolé, filtré par une liste d’autorisation d’édition et les tests du dépôt, et conservé uniquement si le gain mesuré dépasse la bande de bruit. Par défaut, les survivants sont proposés en pull requests GitHub à l’état de brouillon, que tu relis et publies toi-même.",
				"display_name": "Auto-Improvement",
				"highlight_1": "Prouve d’abord sa propre métrique — une exécution refuse de démarrer sur une règle peu fiable",
				"highlight_2": "Chaque candidat est mesuré en A/B, ou RED/GREEN pour les corrections de bugs, jamais un simple « ça a l’air bon »",
				"highlight_3": "Ne conserve un changement que si le gain dépasse la bande de bruit mesurée",
				"highlight_4": "Rédige des pull requests GitHub — en brouillon uniquement, jamais publiées ni fusionnées pour vous",
				"highlight_5": "Travaille sur un clone sans droit de push, afin que rien ne quitte le bac à sable sans relecture",
				"highlight_6": "Une session de discussion reprenable par pull request, par constat et par exécution",
				"page_label": "Auto-Improve",
				"use_case_1": "Démontre des gains de performances mesurables ou des corrections de bugs reproductibles avant de transformer les candidats retenus en modifications GitHub à relire.",
				"configuration_1": "L'hôte de la passerelle doit disposer de Git et d'une CLI gh authentifiée ; connecte un dépôt GitHub, choisis sa branche de base et étalonne une mesure avant les tests de performances."
			},
			"setupPanel": { "https_github_com_owner_repo": "https://github.com/owner/repo" }
		} },
		autoImprovement: {
			"activityDiscovered": "(découverts {{discovered}}, nouveaux {{fresh}})",
			"autocommitHint": "Pousse chaque changement vérifié directement sur la branche de base. Les branches protégées reviennent toujours à un brouillon de pull request.",
			"autocommitLabel": "Valider directement sur la branche (sans pull request)",
			"band": "bande",
			"base": "Base",
			"branchDefault": "Valeur par défaut du dépôt",
			"branchLabel": "Branche de base",
			"calibrated": "Calibrée",
			"changesHeading": "Brouillons de pull requests",
			"cloneBtn": "Connecter",
			"colActions": "Actions",
			"colChange": "Changement",
			"colChecks": "Vérifications",
			"colPr": "Pull request",
			"colVerdict": "État",
			"commitConfirm": "Valider cette modification sur « {{branch}} » et la pousser ? Un commit publié ne peut pas être retiré.",
			"commitFailed": "Le commit a été refusé.",
			"commitFinding": "Valider sur la branche",
			"currentRepo": "En cours sur",
			"cycle": "Cycle",
			"defectHeading": "Défaut",
			"delta": "Écart mesuré",
			"detailUnavailable": "Aucun détail disponible pour ce constat.",
			"discussFinding": "Discuter de ce constat",
			"discussPr": "Discuter de cette pull request",
			"discussRuler": "Discuter de la règle",
			"draftPr": "Brouillon",
			"findingTitlePrefix": "Constat",
			"findingsHeading": "Journal des constats",
			"findingsStat": "Constats",
			"findingsTruncated": "Affichage des {{shown}} constats les plus récents sur {{total}}.",
			"fingerprint": "Empreinte",
			"gateHeading": "Contrôles de vérification",
			"gateNote": "Note du contrôle",
			"historyHeading": "Historique des états",
			"hypothesisHeading": "Hypothèse de reproduction",
			"idleStatus": "Inactif — démarrez une exécution pour trouver des améliorations et préparer des pull requests.",
			"intro": "Corrige les bogues d'un dépôt et ne garde que ce que ses tests prouvent : chaque correction doit faire passer un test en échec sans casser le reste, et les survivants deviennent des pull requests en brouillon que vous relisez.",
			"keptStat": "Conservés",
			"loadingDetail": "Chargement des détails…",
			"noFindings": "Aucun constat enregistré pour l'instant.",
			"noPrs": "Aucune pull request préparée pour l'instant.",
			"prStat": "Pull requests",
			"prTitlePrefix": "PR",
			"pushDisabled": "envoi désactivé",
			"queuedOnly": "en file locale, non ouverte",
			"refreshPr": "Actualiser l'état de la pull request",
			"regressed": "Tests en régression : {{tests}}",
			"repoLabel": "Dépôt GitHub à améliorer",
			"reproTest": "Test de reproduction",
			"rulerHeading": "La règle",
			"rulerNotReady": "La règle n'est pas encore calibrée. Elle ne sert qu'à juger les gains de vitesse ; les exécutions lancées depuis cette page corrigent des bogues, et ce sont les tests du dépôt qui jugent chaque correction.",
			"rulerReady": "Règle calibrée et prête",
			"rulerSessionTitle": "Revue de la règle",
			"rulerStat": "Règle",
			"runBtn": "Démarrer",
			"runError": "L'exécution s'est arrêtée sur une erreur.",
			"runningStatus": "En cours — cycle {{cycle}}, {{kept}} conservés, {{drafted}} pull requests préparées.",
			"setupHeading": "Dépôt",
			"showDiff": "Afficher la modification",
			"showPrBody": "Afficher la description de la pull request",
			"statusCommitted": "Validé sur la branche",
			"statusDiscardedNoise": "Sous la bande de bruit",
			"statusDuplicate": "Doublon",
			"statusError": "Erreur d'outillage",
			"statusFailedGate": "Rejeté par le contrôle",
			"statusFailedVerify": "Le correctif n'a pas été vérifié",
			"statusFiled": "Pull request en brouillon",
			"statusNoDefect": "Aucun défaut trouvé",
			"statusPurged": "Supprimé par l'opérateur",
			"statusSeen": "Vu",
			"statusUnavailable": "Indisponible",
			"stopBtn": "Arrêter",
			"title": "Auto-amélioration",
			"toggleDetail": "Afficher les détails du constat",
			"truncated": "tronqué",
			"uncalibrated": "Non calibrée",
			"viewCommit": "Voir le commit",
			"viewPr": "Pull request"
		},
		pages: { "chatPage": { "could_not_start_a_new_session": "Impossible de démarrer une nouvelle session" } }
	},
	hi: {
		apps: { "autoImprovement": {
			"findingDetail": {
				"build": "बिल्ड",
				"collects": "संग्रह",
				"green": "GREEN",
				"lint": "लिंट",
				"red": "RED",
				"staygreen": "STAYGREEN"
			},
			"manifest": {
				"description": "किसी GitHub रिपॉज़िटरी को बदलने से पहले उसे मापता है। एक कैलिब्रेटेड प्रदर्शन मीट्रिक (पैमाना) तैयार करता है, किसी ज्ञात सुधार के मुक़ाबले साबित करता है कि मीट्रिक भरोसेमंद है, और फिर रखो-या-पलटो सुधार चक्र चलाता है: हर संभावित सुधार एक अलग worktree में लिखा जाता है, संपादन-अनुमति सूची और रिपॉज़िटरी के अपने परीक्षणों से जाँचा जाता है, और तभी रखा जाता है जब मापा गया लाभ शोर-पट्टी से ऊपर हो। डिफ़ॉल्ट रूप से, बचे हुए सुधार GitHub पुल रिक्वेस्ट के ड्राफ़्ट के रूप में तैयार होते हैं, जिन्हें तुम स्वयं देखकर प्रकाशित करते हो।",
				"display_name": "Auto-Improvement",
				"use_case_1": "सफल विकल्पों को समीक्षा योग्य GitHub बदलावों में बदलने से पहले मापने योग्य प्रदर्शन लाभ या दोहराए जा सकने वाले bug fix साबित करें।",
				"configuration_1": "गेटवे होस्ट पर git और प्रमाणित gh CLI चाहिए; GitHub रिपॉज़िटरी कनेक्ट करें, उसकी आधार ब्रांच चुनें और प्रदर्शन रन से पहले ruler को कैलिब्रेट करें।",
				"highlight_1": "पहले अपना ही पैमाना साबित करता है — भरोसेमंद न हो तो रन शुरू ही नहीं होता",
				"highlight_2": "हर उम्मीदवार A/B में मापा जाता है, बग-फ़िक्स के लिए RED/GREEN — केवल «ठीक लगता है» पर नहीं",
				"highlight_3": "बदलाव तभी रखता है जब लाभ मापी गई शोर-पट्टी से ऊपर हो",
				"highlight_4": "GitHub पुल रिक्वेस्ट तैयार करता है — केवल ड्राफ़्ट, तुम्हारे लिए कभी प्रकाशित या मर्ज नहीं",
				"highlight_5": "push-रहित क्लोन पर चलता है, इसलिए कुछ भी बिना समीक्षा सैंडबॉक्स से बाहर नहीं जाता",
				"highlight_6": "हर पुल रिक्वेस्ट, हर निष्कर्ष और हर रन के लिए एक फिर-से-शुरू होने वाला चैट सत्र",
				"page_label": "Auto-Improve"
			},
			"setupPanel": { "https_github_com_owner_repo": "https://github.com/owner/repo" }
		} },
		autoImprovement: {
			"activityDiscovered": "(खोजे गए {{discovered}}, नए {{fresh}})",
			"autocommitHint": "हर सत्यापित बदलाव को सीधे बेस ब्रांच में पुश करें। संरक्षित ब्रांच हमेशा ड्राफ़्ट PR पर वापस आ जाती हैं।",
			"autocommitLabel": "सीधे ब्रांच में कमिट करें (कोई पुल रिक्वेस्ट नहीं)",
			"band": "बैंड",
			"base": "आधार",
			"branchDefault": "रिपॉज़िटरी डिफ़ॉल्ट",
			"branchLabel": "बेस ब्रांच",
			"calibrated": "कैलिब्रेट किया गया",
			"changesHeading": "ड्राफ़्ट पुल रिक्वेस्ट",
			"cloneBtn": "कनेक्ट करें",
			"colActions": "क्रियाएँ",
			"colChange": "बदलाव",
			"colChecks": "जाँच",
			"colPr": "पुल रिक्वेस्ट",
			"colVerdict": "स्थिति",
			"commitConfirm": "यह बदलाव “{{branch}}” में कमिट करके पुश करें? प्रकाशित कमिट वापस नहीं लिया जा सकता।",
			"commitFailed": "कमिट अस्वीकार कर दिया गया।",
			"commitFinding": "ब्रांच में कमिट करें",
			"currentRepo": "इस पर काम हो रहा है",
			"cycle": "चक्र",
			"defectHeading": "दोष",
			"delta": "मापा गया अंतर",
			"detailUnavailable": "इस निष्कर्ष के लिए विवरण उपलब्ध नहीं है।",
			"discussFinding": "इस निष्कर्ष पर चर्चा करें",
			"discussPr": "इस पुल रिक्वेस्ट पर चर्चा करें",
			"discussRuler": "मापक पर चर्चा करें",
			"draftPr": "ड्राफ़्ट",
			"findingTitlePrefix": "निष्कर्ष",
			"findingsHeading": "निष्कर्ष बही",
			"findingsStat": "निष्कर्ष",
			"findingsTruncated": "{{total}} निष्कर्षों में से {{shown}} सबसे नए दिखाए जा रहे हैं।",
			"fingerprint": "फ़िंगरप्रिंट",
			"gateHeading": "सत्यापन जाँच",
			"gateNote": "जाँच टिप्पणी",
			"historyHeading": "स्थिति इतिहास",
			"hypothesisHeading": "पुनरुत्पादन परिकल्पना",
			"idleStatus": "निष्क्रिय — सुधार खोजने और पुल रिक्वेस्ट तैयार करने के लिए रन शुरू करें।",
			"intro": "किसी रिपॉज़िटरी के बग ठीक करता है और केवल वही रखता है जो उसके टेस्ट साबित करें: हर सुधार को एक विफल टेस्ट पास कराना होता है, बाकी को तोड़े बिना, और बचे हुए सुधार ड्राफ़्ट पुल रिक्वेस्ट बनते हैं जिनकी आप समीक्षा करते हैं।",
			"keptStat": "रखे गए",
			"loadingDetail": "विवरण लोड हो रहा है…",
			"noFindings": "अभी कोई निष्कर्ष दर्ज नहीं है।",
			"noPrs": "अभी कोई पुल रिक्वेस्ट तैयार नहीं की गई।",
			"prStat": "पुल रिक्वेस्ट",
			"prTitlePrefix": "पीआर",
			"pushDisabled": "पुश अक्षम",
			"queuedOnly": "स्थानीय रूप से कतारबद्ध, खोला नहीं गया",
			"refreshPr": "पुल रिक्वेस्ट स्थिति ताज़ा करें",
			"regressed": "प्रभावित परीक्षण: {{tests}}",
			"repoLabel": "सुधारने के लिए GitHub रिपॉज़िटरी",
			"reproTest": "पुनरुत्पादन परीक्षण",
			"rulerHeading": "मापक",
			"rulerNotReady": "मापक अभी कैलिब्रेट नहीं है। इसका उपयोग केवल गति-सुधार परखने के लिए होता है; इस पेज से शुरू किए गए रन बग ठीक करते हैं, और हर सुधार को रिपॉज़िटरी के अपने टेस्ट परखते हैं।",
			"rulerReady": "मापक कैलिब्रेट और तैयार है",
			"rulerSessionTitle": "मापक समीक्षा",
			"rulerStat": "मापक",
			"runBtn": "रन शुरू करें",
			"runError": "रन एक त्रुटि के साथ रुक गया।",
			"runningStatus": "चल रहा है — चक्र {{cycle}}, {{kept}} रखे गए, {{drafted}} पुल रिक्वेस्ट तैयार।",
			"setupHeading": "रिपॉज़िटरी",
			"showDiff": "बदलाव देखें",
			"showPrBody": "पुल रिक्वेस्ट विवरण देखें",
			"statusCommitted": "ब्रांच में कमिट हुआ",
			"statusDiscardedNoise": "शोर बैंड से नीचे",
			"statusDuplicate": "डुप्लिकेट",
			"statusError": "टूलिंग त्रुटि",
			"statusFailedGate": "गेट द्वारा अस्वीकृत",
			"statusFailedVerify": "सुधार सत्यापित नहीं हुआ",
			"statusFiled": "पुल रिक्वेस्ट का ड्राफ़्ट बना",
			"statusNoDefect": "कोई दोष नहीं मिला",
			"statusPurged": "ऑपरेटर द्वारा हटाया गया",
			"statusSeen": "देखा गया",
			"statusUnavailable": "अनुपलब्ध",
			"stopBtn": "रन रोकें",
			"title": "स्वतः सुधार",
			"toggleDetail": "निष्कर्ष विवरण दिखाएँ",
			"truncated": "संक्षिप्त",
			"uncalibrated": "कैलिब्रेट नहीं है",
			"viewCommit": "कमिट देखें",
			"viewPr": "पुल रिक्वेस्ट"
		},
		pages: { "chatPage": { "could_not_start_a_new_session": "नया सेशन शुरू नहीं हो सका" } }
	},
	it: {
		apps: { "autoImprovement": {
			"findingDetail": {
				"build": "build",
				"collects": "raccoglie",
				"green": "GREEN",
				"lint": "lint",
				"red": "RED",
				"staygreen": "STAYGREEN"
			},
			"manifest": {
				"description": "Misura un repository GitHub prima di modificarlo. Progetta una metrica di prestazione calibrata (il metro), dimostra che la metrica è affidabile rispetto a un miglioramento noto, poi esegue cicli mantieni-o-annulla: ogni correzione candidata viene scritta in un worktree isolato, filtrata da un elenco di file modificabili e dai test del repository, e mantenuta solo quando il guadagno misurato supera la banda di rumore. Per impostazione predefinita, i sopravvissuti vengono redatti come pull request GitHub in bozza, che sei tu a rivedere e pubblicare.",
				"display_name": "Auto-Improvement",
				"highlight_1": "Dimostra prima la propria metrica: un’esecuzione si rifiuta di partire con un metro inaffidabile",
				"highlight_2": "Ogni candidato è misurato in A/B, o RED/GREEN per le correzioni di bug, mai solo “sembra giusto”",
				"highlight_3": "Mantiene una modifica solo quando il guadagno supera la banda di rumore misurata",
				"highlight_4": "Redige pull request GitHub: solo bozze, mai pubblicate né unite per te",
				"highlight_5": "Lavora su un clone senza push, così nulla esce dalla sandbox senza revisione",
				"highlight_6": "Una sessione di chat riprendibile per ogni pull request, risultato ed esecuzione",
				"page_label": "Auto-Improve",
				"use_case_1": "Dimostra miglioramenti misurabili delle prestazioni o correzioni di bug riproducibili prima di trasformare i candidati riusciti in modifiche GitHub da revisionare.",
				"configuration_1": "L'host del gateway deve avere Git e la CLI gh autenticata; collega un repository GitHub, scegli il branch di base e calibra una misura prima dei test delle prestazioni."
			},
			"setupPanel": { "https_github_com_owner_repo": "https://github.com/owner/repo" }
		} },
		autoImprovement: {
			"activityDiscovered": "(rilevati {{discovered}}, nuovi {{fresh}})",
			"autocommitHint": "Invia ogni modifica verificata direttamente al ramo base. I rami protetti ricadono sempre su una bozza di pull request.",
			"autocommitLabel": "Commit diretto sul ramo (nessuna pull request)",
			"band": "banda",
			"base": "Base",
			"branchDefault": "Predefinito del repository",
			"branchLabel": "Ramo base",
			"calibrated": "Calibrato",
			"changesHeading": "Bozze di pull request",
			"cloneBtn": "Connetti",
			"colActions": "Azioni",
			"colChange": "Modifica",
			"colChecks": "Controlli",
			"colPr": "Pull request",
			"colVerdict": "Stato",
			"commitConfirm": "Applicare questa modifica su «{{branch}}» e inviarla? Un commit pubblicato non può essere ritirato.",
			"commitFailed": "Il commit è stato rifiutato.",
			"commitFinding": "Commit sul ramo",
			"currentRepo": "In lavorazione su",
			"cycle": "Ciclo",
			"defectHeading": "Difetto",
			"delta": "Differenza misurata",
			"detailUnavailable": "Nessun dettaglio disponibile per questo rilievo.",
			"discussFinding": "Discuti questo rilievo",
			"discussPr": "Discuti questa pull request",
			"discussRuler": "Discuti il righello",
			"draftPr": "Bozza",
			"findingTitlePrefix": "Rilievo",
			"findingsHeading": "Registro dei rilievi",
			"findingsStat": "Rilievi",
			"findingsTruncated": "Vengono mostrati i {{shown}} rilievi più recenti su {{total}}.",
			"fingerprint": "Impronta",
			"gateHeading": "Verifiche",
			"gateNote": "Nota della verifica",
			"historyHeading": "Cronologia degli stati",
			"hypothesisHeading": "Ipotesi di riproduzione",
			"idleStatus": "Inattivo — avvia un'esecuzione per trovare miglioramenti e preparare pull request.",
			"intro": "Corregge i bug di un repository e conserva solo ciò che i suoi test dimostrano: ogni correzione deve far passare un test che falliva senza rompere il resto, e ciò che sopravvive diventa una pull request in bozza che rivedi tu.",
			"keptStat": "Mantenute",
			"loadingDetail": "Caricamento dei dettagli…",
			"noFindings": "Nessun rilievo ancora registrato.",
			"noPrs": "Nessuna pull request ancora preparata.",
			"prStat": "Pull request",
			"prTitlePrefix": "PR",
			"pushDisabled": "push disabilitato",
			"queuedOnly": "in coda locale, non aperta",
			"refreshPr": "Aggiorna lo stato della pull request",
			"regressed": "Test in regressione: {{tests}}",
			"repoLabel": "Repository GitHub da migliorare",
			"reproTest": "Test di riproduzione",
			"rulerHeading": "Il righello",
			"rulerNotReady": "Il righello non è ancora calibrato. Serve solo a valutare i miglioramenti di velocità; le esecuzioni avviate da questa pagina correggono bug, e ogni correzione viene valutata dai test del repository.",
			"rulerReady": "Righello calibrato e pronto",
			"rulerSessionTitle": "Revisione del righello",
			"rulerStat": "Righello",
			"runBtn": "Avvia esecuzione",
			"runError": "L'esecuzione si è interrotta con un errore.",
			"runningStatus": "In esecuzione — ciclo {{cycle}}, {{kept}} mantenute, {{drafted}} pull request preparate.",
			"setupHeading": "Repository",
			"showDiff": "Mostra la modifica",
			"showPrBody": "Mostra la descrizione della pull request",
			"statusCommitted": "Applicato al branch",
			"statusDiscardedNoise": "Sotto la banda di rumore",
			"statusDuplicate": "Duplicato",
			"statusError": "Errore degli strumenti",
			"statusFailedGate": "Respinto dal controllo",
			"statusFailedVerify": "La correzione non è stata verificata",
			"statusFiled": "Pull request in bozza",
			"statusNoDefect": "Nessun difetto trovato",
			"statusPurged": "Eliminato dall'operatore",
			"statusSeen": "Visto",
			"statusUnavailable": "Non disponibile",
			"stopBtn": "Ferma esecuzione",
			"title": "Automiglioramento",
			"toggleDetail": "Mostra i dettagli del rilievo",
			"truncated": "troncato",
			"uncalibrated": "Non calibrato",
			"viewCommit": "Vedi commit",
			"viewPr": "Pull request"
		},
		pages: { "chatPage": { "could_not_start_a_new_session": "Impossibile avviare una nuova sessione" } }
	},
	ja: {
		apps: { "autoImprovement": {
			"findingDetail": {
				"build": "ビルド",
				"collects": "収集",
				"green": "GREEN",
				"lint": "lint",
				"red": "RED",
				"staygreen": "STAYGREEN"
			},
			"manifest": {
				"use_case_1": "測定可能な性能向上または再現可能な不具合修正を証明してから、採用された結果をレビュー可能な GitHub の変更にします。",
				"configuration_1": "ゲートウェイホストには git と認証済みの gh CLI が必要です。GitHub リポジトリを接続し、ベースブランチを選び、性能改善を実行する前にルーラーを校正します。",
				"description": "GitHub リポジトリを変更する前に測定します。校正済みの性能指標（ものさし）を設計し、既知の改善に対してその指標が信頼できることを証明したうえで、保持か巻き戻しの改善サイクルを実行します。候補となる修正はすべて隔離された worktree で書かれ、編集許可リストとリポジトリ自身のテストで検査され、測定した改善がノイズ帯を超えたときにだけ保持されます。既定では、残ったものは、あなたがレビューして自分で公開する GitHub のドラフトのプルリクエストになります。",
				"display_name": "Auto-Improvement",
				"highlight_1": "まず自らの指標を証明します — 信頼できないものさしでは実行を開始しません",
				"highlight_2": "候補はすべて A/B で測定し、バグ修正では RED/GREEN で確認します。「良さそう」では判断しません",
				"highlight_3": "改善が測定したノイズ帯を超えたときにだけ変更を保持します",
				"highlight_4": "GitHub のプルリクエストを下書きします — 下書きのみで、代わりに公開やマージはしません",
				"highlight_5": "プッシュを無効化したクローンで動くため、レビューを経ずにサンドボックスから出るものはありません",
				"highlight_6": "プルリクエスト、検出結果、実行ごとに再開できるチャットセッションが 1 つ",
				"page_label": "Auto-Improve"
			},
			"setupPanel": { "https_github_com_owner_repo": "https://github.com/owner/repo" }
		} },
		autoImprovement: {
			"activityDiscovered": "（検出 {{discovered}}、新規 {{fresh}}）",
			"autocommitHint": "検証済みの変更をベースブランチへ直接プッシュします。保護されたブランチでは常にドラフトのプルリクエストにフォールバックします。",
			"autocommitLabel": "ブランチに直接コミットする（プルリクエストなし）",
			"band": "帯",
			"base": "ベース",
			"branchDefault": "リポジトリの既定",
			"branchLabel": "ベースブランチ",
			"calibrated": "校正済み",
			"changesHeading": "ドラフトのプルリクエスト",
			"cloneBtn": "接続",
			"colActions": "操作",
			"colChange": "変更",
			"colChecks": "チェック",
			"colPr": "プルリクエスト",
			"colVerdict": "状態",
			"commitConfirm": "この変更を 「{{branch}}」 にコミットしてプッシュしますか？公開したコミットは取り消せません。",
			"commitFailed": "コミットは拒否されました。",
			"commitFinding": "ブランチにコミット",
			"currentRepo": "対象",
			"cycle": "サイクル",
			"defectHeading": "不具合",
			"delta": "測定した差分",
			"detailUnavailable": "この検出結果の詳細は利用できません。",
			"discussFinding": "この検出結果について相談する",
			"discussPr": "このプルリクエストについて相談する",
			"discussRuler": "ものさしについて相談する",
			"draftPr": "ドラフト",
			"findingTitlePrefix": "検出結果",
			"findingsHeading": "検出結果の記録",
			"findingsStat": "検出結果",
			"findingsTruncated": "全 {{total}} 件のうち直近 {{shown}} 件を表示しています。",
			"fingerprint": "フィンガープリント",
			"gateHeading": "検証ゲート",
			"gateNote": "ゲートの備考",
			"historyHeading": "状態の履歴",
			"hypothesisHeading": "再現の仮説",
			"idleStatus": "待機中 — 実行を開始すると改善点を探し、プルリクエストの下書きを作成します。",
			"intro": "リポジトリのバグを修正し、テストで証明されたものだけを残します。各修正は、ほかを壊さずに失敗していたテストを成功させる必要があり、残った修正はあなたがレビューするドラフトのプルリクエストになります。",
			"keptStat": "保持",
			"loadingDetail": "詳細を読み込んでいます…",
			"noFindings": "まだ検出結果は記録されていません。",
			"noPrs": "まだプルリクエストの下書きはありません。",
			"prStat": "プルリクエスト",
			"prTitlePrefix": "PR",
			"pushDisabled": "プッシュ無効",
			"queuedOnly": "ローカルに保留中、未作成",
			"refreshPr": "プルリクエストの状態を更新",
			"regressed": "退行したテスト: {{tests}}",
			"repoLabel": "改善対象の GitHub リポジトリ",
			"reproTest": "再現テスト",
			"rulerHeading": "ものさし",
			"rulerNotReady": "ものさしはまだ校正されていません。ものさしは高速化の判定にだけ使われます。このページから開始する実行はバグを修正するもので、各修正はリポジトリのテストで判定されます。",
			"rulerReady": "ものさしは校正済みで準備できています",
			"rulerSessionTitle": "ものさしのレビュー",
			"rulerStat": "ものさし",
			"runBtn": "実行を開始",
			"runError": "実行はエラーで停止しました。",
			"runningStatus": "実行中 — サイクル {{cycle}}、保持 {{kept}} 件、プルリクエスト下書き {{drafted}} 件。",
			"setupHeading": "リポジトリ",
			"showDiff": "変更を表示",
			"showPrBody": "プルリクエストの説明を表示",
			"statusCommitted": "ブランチにコミット済み",
			"statusDiscardedNoise": "ノイズ帯を下回る",
			"statusDuplicate": "重複",
			"statusError": "ツールのエラー",
			"statusFailedGate": "ゲートで却下",
			"statusFailedVerify": "修正を検証できなかった",
			"statusFiled": "プルリクエストの下書きを作成",
			"statusNoDefect": "不具合は見つからなかった",
			"statusPurged": "運用者が削除",
			"statusSeen": "確認済み",
			"statusUnavailable": "利用不可",
			"stopBtn": "実行を停止",
			"title": "Auto-Improvement",
			"toggleDetail": "検出結果の詳細を表示",
			"truncated": "省略",
			"uncalibrated": "未校正",
			"viewCommit": "コミットを表示",
			"viewPr": "プルリクエスト"
		},
		pages: { "chatPage": { "could_not_start_a_new_session": "新しいセッションを開始できませんでした" } }
	},
	ko: {
		apps: { "autoImprovement": {
			"findingDetail": {
				"build": "빌드",
				"collects": "수집",
				"green": "GREEN",
				"lint": "lint",
				"red": "RED",
				"staygreen": "STAYGREEN"
			},
			"manifest": {
				"use_case_1": "측정 가능한 성능 향상 또는 재현 가능한 버그 수정을 입증한 뒤, 통과한 결과를 검토 가능한 GitHub 변경 사항으로 만듭니다.",
				"configuration_1": "게이트웨이 호스트에는 git과 인증된 gh CLI가 필요합니다. GitHub 저장소를 연결하고 기준 브랜치를 선택한 다음, 성능 실행 전에 측정 기준을 보정하세요.",
				"description": "GitHub 저장소를 변경하기 전에 먼저 측정합니다. 보정된 성능 지표(잣대)를 설계하고, 이미 알려진 개선으로 그 지표가 믿을 만한지 증명한 뒤, 유지 또는 되돌리기 개선 주기를 실행합니다. 모든 후보 수정은 격리된 worktree에서 작성되고, 편집 허용 목록과 저장소 자체 테스트로 검사되며, 측정된 개선이 잡음 구간을 넘어설 때만 유지됩니다. 기본적으로 살아남은 변경은 직접 리뷰하고 공개하는 GitHub 풀 리퀘스트 초안이 됩니다.",
				"display_name": "Auto-Improvement",
				"highlight_1": "지표부터 증명합니다 — 잣대를 믿을 수 없으면 실행을 시작하지 않습니다",
				"highlight_2": "모든 후보를 A/B로, 버그 수정은 RED/GREEN으로 측정합니다. ‘괜찮아 보인다’로 판단하지 않습니다",
				"highlight_3": "개선이 측정된 잡음 구간을 넘어설 때만 변경을 유지합니다",
				"highlight_4": "GitHub 풀 리퀘스트를 초안으로 작성합니다 — 초안만 만들며, 대신 공개하거나 병합하지 않습니다",
				"highlight_5": "푸시가 비활성화된 클론에서 동작하므로 리뷰 없이 샌드박스를 벗어나는 것은 없습니다",
				"highlight_6": "풀 리퀘스트·발견 항목·실행마다 이어서 쓸 수 있는 채팅 세션 하나",
				"page_label": "Auto-Improve"
			},
			"setupPanel": { "https_github_com_owner_repo": "https://github.com/owner/repo" }
		} },
		autoImprovement: {
			"activityDiscovered": "(발견 {{discovered}}, 신규 {{fresh}})",
			"autocommitHint": "검증된 변경을 베이스 브랜치로 바로 푸시합니다. 보호된 브랜치에서는 항상 풀 리퀘스트 초안으로 대체됩니다.",
			"autocommitLabel": "브랜치에 직접 커밋(풀 리퀘스트 없음)",
			"band": "구간",
			"base": "베이스",
			"branchDefault": "저장소 기본값",
			"branchLabel": "베이스 브랜치",
			"calibrated": "보정됨",
			"changesHeading": "풀 리퀘스트 초안",
			"cloneBtn": "연결",
			"colActions": "작업",
			"colChange": "변경",
			"colChecks": "검사",
			"colPr": "풀 리퀘스트",
			"colVerdict": "상태",
			"commitConfirm": "이 변경을 ‘{{branch}}’에 커밋하고 푸시하시겠습니까? 공개된 커밋은 되돌릴 수 없습니다.",
			"commitFailed": "커밋이 거부되었습니다.",
			"commitFinding": "브랜치에 커밋",
			"currentRepo": "작업 대상",
			"cycle": "주기",
			"defectHeading": "결함",
			"delta": "측정된 차이",
			"detailUnavailable": "이 발견 항목의 상세 정보를 사용할 수 없습니다.",
			"discussFinding": "이 발견 항목 논의하기",
			"discussPr": "이 풀 리퀘스트 논의하기",
			"discussRuler": "잣대 논의하기",
			"draftPr": "초안",
			"findingTitlePrefix": "발견 항목",
			"findingsHeading": "발견 항목 기록",
			"findingsStat": "발견 항목",
			"findingsTruncated": "전체 {{total}}건 중 최근 {{shown}}건을 표시하고 있습니다.",
			"fingerprint": "핑거프린트",
			"gateHeading": "검증 게이트",
			"gateNote": "게이트 메모",
			"historyHeading": "상태 이력",
			"hypothesisHeading": "재현 가설",
			"idleStatus": "대기 중 — 실행을 시작하면 개선점을 찾아 풀 리퀘스트 초안을 작성합니다.",
			"intro": "저장소의 버그를 고치고 테스트로 입증된 것만 남깁니다. 각 수정은 나머지를 깨뜨리지 않고 실패하던 테스트를 통과시켜야 하며, 살아남은 수정은 직접 검토하는 초안 풀 리퀘스트가 됩니다.",
			"keptStat": "유지",
			"loadingDetail": "상세 정보를 불러오고 있습니다…",
			"noFindings": "아직 기록된 발견 항목이 없습니다.",
			"noPrs": "아직 작성된 풀 리퀘스트 초안이 없습니다.",
			"prStat": "풀 리퀘스트",
			"prTitlePrefix": "PR",
			"pushDisabled": "푸시 비활성화",
			"queuedOnly": "로컬에 대기 중, 생성되지 않음",
			"refreshPr": "풀 리퀘스트 상태 새로 고침",
			"regressed": "퇴행한 테스트: {{tests}}",
			"repoLabel": "개선할 GitHub 저장소",
			"reproTest": "재현 테스트",
			"rulerHeading": "잣대",
			"rulerNotReady": "잣대가 아직 보정되지 않았습니다. 잣대는 속도 개선을 판정할 때만 쓰입니다. 이 페이지에서 시작한 실행은 버그를 고치며, 각 수정은 저장소의 테스트가 판정합니다.",
			"rulerReady": "잣대가 보정되어 준비되었습니다",
			"rulerSessionTitle": "잣대 리뷰",
			"rulerStat": "잣대",
			"runBtn": "실행 시작",
			"runError": "실행이 오류로 중단되었습니다.",
			"runningStatus": "실행 중 — 주기 {{cycle}}, {{kept}}건 유지, 풀 리퀘스트 초안 {{drafted}}건.",
			"setupHeading": "저장소",
			"showDiff": "변경 보기",
			"showPrBody": "풀 리퀘스트 설명 보기",
			"statusCommitted": "브랜치에 커밋됨",
			"statusDiscardedNoise": "잡음 구간 미만",
			"statusDuplicate": "중복",
			"statusError": "도구 오류",
			"statusFailedGate": "게이트에서 거부됨",
			"statusFailedVerify": "수정이 검증되지 않음",
			"statusFiled": "풀 리퀘스트 초안 작성됨",
			"statusNoDefect": "결함을 찾지 못함",
			"statusPurged": "운영자가 삭제함",
			"statusSeen": "확인됨",
			"statusUnavailable": "사용 불가",
			"stopBtn": "실행 중지",
			"title": "Auto-Improvement",
			"toggleDetail": "발견 항목 상세 보기",
			"truncated": "생략됨",
			"uncalibrated": "보정되지 않음",
			"viewCommit": "커밋 보기",
			"viewPr": "풀 리퀘스트"
		},
		pages: { "chatPage": { "could_not_start_a_new_session": "새 세션을 시작할 수 없습니다" } }
	},
	pt: {
		apps: { "autoImprovement": {
			"findingDetail": {
				"build": "build",
				"collects": "coleta",
				"green": "GREEN",
				"lint": "lint",
				"red": "RED",
				"staygreen": "STAYGREEN"
			},
			"manifest": {
				"description": "Mede um repositório do GitHub antes de alterá-lo. Projeta uma métrica de desempenho calibrada (a régua), prova que a métrica é confiável diante de um ganho conhecido e então executa ciclos de manter ou reverter: cada correção candidata é escrita em um worktree isolado, filtrada por uma lista de permissões de edição e pelos testes do próprio repositório, e mantida apenas quando o ganho medido supera a faixa de ruído. Por padrão, as sobreviventes são redigidas como pull requests do GitHub em rascunho, que você revisa e publica.",
				"display_name": "Auto-Improvement",
				"highlight_1": "Prova primeiro a própria métrica — uma execução se recusa a começar com uma régua não confiável",
				"highlight_2": "Cada candidato é medido em A/B, ou RED/GREEN para correções de bugs, nunca apenas “parece certo”",
				"highlight_3": "Mantém uma mudança só quando o ganho supera a faixa de ruído medida",
				"highlight_4": "Redige pull requests do GitHub — apenas rascunhos, nunca publicados nem mesclados por você",
				"highlight_5": "Funciona em um clone sem push, então nada escapa da sandbox sem revisão",
				"highlight_6": "Uma sessão de conversa retomável por pull request, achado e execução",
				"page_label": "Auto-Improve",
				"use_case_1": "Comprove ganhos mensuráveis de desempenho ou correções reproduzíveis de bugs antes de transformar os candidatos aprovados em alterações do GitHub prontas para revisão.",
				"configuration_1": "O host do gateway precisa de Git e da CLI gh autenticada; conecte um repositório do GitHub, escolha a branch base e calibre uma medida antes dos testes de desempenho."
			},
			"setupPanel": { "https_github_com_owner_repo": "https://github.com/owner/repo" }
		} },
		autoImprovement: {
			"activityDiscovered": "(descobertos {{discovered}}, novos {{fresh}})",
			"autocommitHint": "Envia cada alteração verificada diretamente para o ramo base. Ramos protegidos sempre recorrem a um rascunho de pull request.",
			"autocommitLabel": "Fazer commit direto no ramo (sem pull request)",
			"band": "faixa",
			"base": "Base",
			"branchDefault": "Padrão do repositório",
			"branchLabel": "Ramo base",
			"calibrated": "Calibrada",
			"changesHeading": "Rascunhos de pull requests",
			"cloneBtn": "Conectar",
			"colActions": "Ações",
			"colChange": "Alteração",
			"colChecks": "Verificações",
			"colPr": "Pull request",
			"colVerdict": "Estado",
			"commitConfirm": "Confirmar esta alteração em “{{branch}}” e enviá-la? Um commit publicado não pode ser retirado.",
			"commitFailed": "O commit foi recusado.",
			"commitFinding": "Fazer commit no ramo",
			"currentRepo": "Trabalhando em",
			"cycle": "Ciclo",
			"defectHeading": "Defeito",
			"delta": "Diferença medida",
			"detailUnavailable": "Não há detalhes para esta constatação.",
			"discussFinding": "Discutir esta constatação",
			"discussPr": "Discutir esta pull request",
			"discussRuler": "Discutir a régua",
			"draftPr": "Rascunho",
			"findingTitlePrefix": "Constatação",
			"findingsHeading": "Registro de constatações",
			"findingsStat": "Constatações",
			"findingsTruncated": "Exibindo as {{shown}} constatações mais recentes de {{total}}.",
			"fingerprint": "Impressão digital",
			"gateHeading": "Verificações",
			"gateNote": "Nota da verificação",
			"historyHeading": "Histórico de estados",
			"hypothesisHeading": "Hipótese de reprodução",
			"idleStatus": "Ocioso — inicie uma execução para encontrar melhorias e preparar pull requests.",
			"intro": "Corrige bugs em um repositório e mantém só o que os testes dele comprovam: cada correção precisa fazer passar um teste que falhava sem quebrar o resto, e o que sobrevive vira pull requests em rascunho para você revisar.",
			"keptStat": "Mantidas",
			"loadingDetail": "Carregando detalhes…",
			"noFindings": "Nenhuma constatação registrada ainda.",
			"noPrs": "Nenhuma pull request preparada ainda.",
			"prStat": "Pull requests",
			"prTitlePrefix": "PR",
			"pushDisabled": "envio desativado",
			"queuedOnly": "em fila local, não aberta",
			"refreshPr": "Atualizar o estado da pull request",
			"regressed": "Testes com regressão: {{tests}}",
			"repoLabel": "Repositório do GitHub a melhorar",
			"reproTest": "Teste de reprodução",
			"rulerHeading": "A régua",
			"rulerNotReady": "A régua ainda não está calibrada. Ela só é usada para julgar ganhos de velocidade; as execuções iniciadas nesta página corrigem bugs, e cada correção é julgada pelos testes do repositório.",
			"rulerReady": "Régua calibrada e pronta",
			"rulerSessionTitle": "Revisão da régua",
			"rulerStat": "Régua",
			"runBtn": "Iniciar execução",
			"runError": "A execução parou com um erro.",
			"runningStatus": "Em execução — ciclo {{cycle}}, {{kept}} mantidas, {{drafted}} pull requests preparadas.",
			"setupHeading": "Repositório",
			"showDiff": "Ver a alteração",
			"showPrBody": "Ver a descrição da pull request",
			"statusCommitted": "Confirmado no branch",
			"statusDiscardedNoise": "Abaixo da banda de ruído",
			"statusDuplicate": "Duplicado",
			"statusError": "Erro de ferramentas",
			"statusFailedGate": "Rejeitado pelo controle",
			"statusFailedVerify": "A correção não foi verificada",
			"statusFiled": "Pull request em rascunho",
			"statusNoDefect": "Nenhum defeito encontrado",
			"statusPurged": "Excluído pelo operador",
			"statusSeen": "Visto",
			"statusUnavailable": "Indisponível",
			"stopBtn": "Parar execução",
			"title": "Automelhoria",
			"toggleDetail": "Mostrar detalhes da constatação",
			"truncated": "truncado",
			"uncalibrated": "Não calibrada",
			"viewCommit": "Ver commit",
			"viewPr": "Pull request"
		},
		pages: { "chatPage": { "could_not_start_a_new_session": "Não foi possível iniciar uma nova sessão" } }
	},
	ru: {
		apps: { "autoImprovement": {
			"findingDetail": {
				"build": "сборка",
				"collects": "собирается",
				"green": "GREEN",
				"lint": "линтер",
				"red": "RED",
				"staygreen": "STAYGREEN"
			},
			"manifest": {
				"description": "Измеряет репозиторий GitHub, прежде чем его менять. Строит калиброванную метрику производительности (линейку), доказывает её надёжность на заведомом улучшении, а затем выполняет циклы «оставить или откатить»: каждое предлагаемое исправление создаётся в изолированном worktree, проверяется по списку разрешённых к правке файлов и тестами самого репозитория и сохраняется только тогда, когда измеренный выигрыш превышает полосу шума. По умолчанию уцелевшие оформляются как черновые pull request’ы GitHub, которые ты просматриваешь и публикуешь сам.",
				"display_name": "Auto-Improvement",
				"use_case_1": "Подтверждайте измеримый прирост производительности или воспроизводимые исправления ошибок, прежде чем превращать прошедшие отбор варианты в проверяемые изменения на GitHub.",
				"configuration_1": "На хосте шлюза нужны git и авторизованный gh CLI; подключите репозиторий GitHub, выберите базовую ветку и откалибруйте линейку перед замерами производительности.",
				"highlight_1": "Сначала доказывает собственную метрику — запуск не начнётся с ненадёжной линейкой",
				"highlight_2": "Каждый вариант измеряется A/B, а исправления ошибок — RED/GREEN, а не «на вид правильно»",
				"highlight_3": "Сохраняет изменение только если выигрыш превышает измеренную полосу шума",
				"highlight_4": "Готовит pull request’ы GitHub — только черновики, ничего не публикуется и не сливается за вас",
				"highlight_5": "Работает на клоне без права push, поэтому ничто не покидает песочницу без проверки",
				"highlight_6": "Одна возобновляемая сессия чата на каждый pull request, находку и запуск",
				"page_label": "Auto-Improve"
			},
			"setupPanel": { "https_github_com_owner_repo": "https://github.com/owner/repo" }
		} },
		autoImprovement: {
			"activityDiscovered": "(найдено {{discovered}}, новых {{fresh}})",
			"autocommitHint": "Отправлять каждое проверенное изменение прямо в базовую ветку. Защищённые ветки всегда откатываются к черновику пул-реквеста.",
			"autocommitLabel": "Коммитить прямо в ветку (без пул-реквеста)",
			"band": "полоса шума",
			"base": "База",
			"branchDefault": "По умолчанию для репозитория",
			"branchLabel": "Базовая ветка",
			"calibrated": "Откалибрована",
			"changesHeading": "Черновики пул-реквестов",
			"cloneBtn": "Подключить",
			"colActions": "Действия",
			"colChange": "Изменение",
			"colChecks": "Проверки",
			"colPr": "Пул-реквест",
			"colVerdict": "Состояние",
			"commitConfirm": "Зафиксировать это изменение в «{{branch}}» и отправить? Опубликованный коммит нельзя отозвать.",
			"commitFailed": "Коммит отклонён.",
			"commitFinding": "Закоммитить в ветку",
			"currentRepo": "В работе",
			"cycle": "Цикл",
			"defectHeading": "Дефект",
			"delta": "Измеренная разница",
			"detailUnavailable": "Детали для этой находки недоступны.",
			"discussFinding": "Обсудить эту находку",
			"discussPr": "Обсудить этот пул-реквест",
			"discussRuler": "Обсудить линейку",
			"draftPr": "Черновик",
			"findingTitlePrefix": "Находка",
			"findingsHeading": "Журнал находок",
			"findingsStat": "Находки",
			"findingsTruncated": "Показаны {{shown}} последних находок из {{total}}.",
			"fingerprint": "Отпечаток",
			"gateHeading": "Проверки",
			"gateNote": "Примечание проверки",
			"historyHeading": "История состояний",
			"hypothesisHeading": "Гипотеза воспроизведения",
			"idleStatus": "Простой — запустите прогон, чтобы найти улучшения и подготовить пул-реквесты.",
			"intro": "Исправляет ошибки в репозитории и оставляет только то, что подтверждают его тесты: каждое исправление должно сделать падающий тест зелёным, не сломав остальные, а уцелевшие становятся черновыми пул-реквестами, которые вы проверяете.",
			"keptStat": "Оставлено",
			"loadingDetail": "Загрузка деталей…",
			"noFindings": "Находок пока не зафиксировано.",
			"noPrs": "Пул-реквесты пока не созданы.",
			"prStat": "Пул-реквесты",
			"prTitlePrefix": "ПР",
			"pushDisabled": "отправка отключена",
			"queuedOnly": "в локальной очереди, не открыт",
			"refreshPr": "Обновить состояние пул-реквеста",
			"regressed": "Регрессировавшие тесты: {{tests}}",
			"repoLabel": "Репозиторий GitHub для улучшения",
			"reproTest": "Тест воспроизведения",
			"rulerHeading": "Линейка",
			"rulerNotReady": "Линейка ещё не откалибрована. Она нужна только для оценки ускорений; запуски с этой страницы исправляют ошибки, и каждое исправление оценивают тесты самого репозитория.",
			"rulerReady": "Линейка откалибрована и готова",
			"rulerSessionTitle": "Разбор линейки",
			"rulerStat": "Линейка",
			"runBtn": "Запустить",
			"runError": "Прогон остановился с ошибкой.",
			"runningStatus": "Выполняется — цикл {{cycle}}, оставлено {{kept}}, подготовлено пул-реквестов: {{drafted}}.",
			"setupHeading": "Репозиторий",
			"showDiff": "Показать изменение",
			"showPrBody": "Показать описание пул-реквеста",
			"statusCommitted": "Зафиксировано в ветке",
			"statusDiscardedNoise": "Ниже полосы шума",
			"statusDuplicate": "Дубликат",
			"statusError": "Ошибка инструментов",
			"statusFailedGate": "Отклонено проверкой",
			"statusFailedVerify": "Исправление не подтвердилось",
			"statusFiled": "Черновик pull request",
			"statusNoDefect": "Дефект не найден",
			"statusPurged": "Удалено оператором",
			"statusSeen": "Замечено",
			"statusUnavailable": "Недоступно",
			"stopBtn": "Остановить",
			"title": "Автоулучшение",
			"toggleDetail": "Показать детали находки",
			"truncated": "обрезано",
			"uncalibrated": "Не откалибрована",
			"viewCommit": "Открыть коммит",
			"viewPr": "Пул-реквест"
		},
		pages: { "chatPage": { "could_not_start_a_new_session": "Не удалось начать новую сессию" } }
	},
	"zh-CN": {
		apps: { "autoImprovement": {
			"findingDetail": {
				"build": "构建",
				"collects": "收集",
				"green": "GREEN",
				"lint": "检查",
				"red": "RED",
				"staygreen": "STAYGREEN"
			},
			"manifest": {
				"use_case_1": "先证明性能提升可度量或缺陷修复可复现，再将通过筛选的结果转为可审阅的 GitHub 改动。",
				"configuration_1": "网关主机需要安装 git 和已认证的 gh CLI；连接 GitHub 仓库，选择基础分支，并在运行性能任务前校准标尺。",
				"description": "先度量 GitHub 仓库，再改动它。先设计一个经过校准的性能指标，也就是标尺；再用一个已知改进来证明该指标可信。随后运行“保留或回滚”改进循环：每个候选修复都写在独立 worktree 中，要通过可编辑文件白名单以及仓库自身测试，只有当实测收益超过噪声带时才会保留。默认情况下，留下来的结果会拟为 GitHub 草稿拉取请求，由你自己审阅并发布。",
				"display_name": "Auto-Improvement",
				"highlight_1": "先证明自己的指标——标尺不可信时，运行会拒绝开始",
				"highlight_2": "每个候选都做 A/B 度量，缺陷修复则用 RED/GREEN，而不是只凭“看起来对”",
				"highlight_3": "只有当收益超过实测噪声带时才保留改动",
				"highlight_4": "拟写 GitHub 拉取请求——仅为草稿，绝不代你发布或合并",
				"highlight_5": "在禁止 push 的克隆上运行，任何东西都不会未经审阅离开沙箱",
				"highlight_6": "每个拉取请求、每项发现、每次运行各有一个可续接的聊天会话",
				"page_label": "Auto-Improve"
			},
			"setupPanel": { "https_github_com_owner_repo": "https://github.com/owner/repo" }
		} },
		autoImprovement: {
			"activityDiscovered": "(发现 {{discovered}} 项，新增 {{fresh}} 项)",
			"autocommitHint": "将每项已验证的改动直接推送到基础分支。受保护的分支始终回退为拉取请求草稿。",
			"autocommitLabel": "直接提交到分支（不创建拉取请求）",
			"band": "噪声带",
			"base": "基准",
			"branchDefault": "仓库默认分支",
			"branchLabel": "基础分支",
			"calibrated": "已校准",
			"changesHeading": "拉取请求草稿",
			"cloneBtn": "连接",
			"colActions": "操作",
			"colChange": "改动",
			"colChecks": "检查",
			"colPr": "拉取请求",
			"colVerdict": "状态",
			"commitConfirm": "将此更改提交到 “{{branch}}” 并推送？已发布的提交无法撤回。",
			"commitFailed": "提交被拒绝。",
			"commitFinding": "提交到分支",
			"currentRepo": "正在处理",
			"cycle": "轮次",
			"defectHeading": "缺陷",
			"delta": "实测差值",
			"detailUnavailable": "此发现项没有可用的详细信息。",
			"discussFinding": "讨论此发现项",
			"discussPr": "讨论此拉取请求",
			"discussRuler": "讨论标尺",
			"draftPr": "草稿",
			"findingTitlePrefix": "发现项",
			"findingsHeading": "发现项台账",
			"findingsStat": "发现项",
			"findingsTruncated": "正在显示 {{total}} 项发现中最近的 {{shown}} 项。",
			"fingerprint": "指纹",
			"gateHeading": "验证关卡",
			"gateNote": "关卡备注",
			"historyHeading": "状态历史",
			"hypothesisHeading": "复现假设",
			"idleStatus": "空闲 — 启动一次运行以查找改进并起草拉取请求。",
			"intro": "修复仓库中的缺陷，只保留其测试能证明的修改：每个修复都必须让一个失败的测试通过且不破坏其他测试，留下的修复会成为由你审阅的草稿拉取请求。",
			"keptStat": "已保留",
			"loadingDetail": "正在加载详细信息…",
			"noFindings": "尚未记录任何发现项。",
			"noPrs": "尚未起草任何拉取请求。",
			"prStat": "拉取请求",
			"prTitlePrefix": "拉取请求",
			"pushDisabled": "推送已禁用",
			"queuedOnly": "仅在本地排队，尚未创建",
			"refreshPr": "刷新拉取请求状态",
			"regressed": "回退的测试：{{tests}}",
			"repoLabel": "要改进的 GitHub 仓库",
			"reproTest": "复现测试",
			"rulerHeading": "标尺",
			"rulerNotReady": "标尺尚未校准。标尺只用于判定性能提速；从本页面启动的运行用于修复缺陷，每个修复由仓库自身的测试来判定。",
			"rulerReady": "标尺已校准并就绪",
			"rulerSessionTitle": "标尺审阅",
			"rulerStat": "标尺",
			"runBtn": "开始运行",
			"runError": "运行因错误而停止。",
			"runningStatus": "正在运行 — 第 {{cycle}} 轮，已保留 {{kept}} 项，已起草 {{drafted}} 个拉取请求。",
			"setupHeading": "仓库",
			"showDiff": "显示改动",
			"showPrBody": "显示拉取请求描述",
			"statusCommitted": "已提交到分支",
			"statusDiscardedNoise": "低于噪声带",
			"statusDuplicate": "重复",
			"statusError": "工具错误",
			"statusFailedGate": "被验证关卡拒绝",
			"statusFailedVerify": "修复未通过验证",
			"statusFiled": "已草拟拉取请求",
			"statusNoDefect": "未发现缺陷",
			"statusPurged": "已由操作者删除",
			"statusSeen": "已发现",
			"statusUnavailable": "不可用",
			"stopBtn": "停止运行",
			"title": "自动改进",
			"toggleDetail": "显示发现项详情",
			"truncated": "已截断",
			"uncalibrated": "未校准",
			"viewCommit": "查看提交",
			"viewPr": "拉取请求"
		},
		pages: { "chatPage": { "could_not_start_a_new_session": "无法启动新会话" } }
	}
};
var own = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
function lookup(catalog, key) {
	let node = catalog;
	for (const part of key.split(".")) {
		if (node === void 0 || typeof node === "string" || !own(node, part)) return void 0;
		node = node[part];
	}
	return typeof node === "string" ? node : void 0;
}
/** The catalogs to try for `locale`, most specific first, always ending in English. */
function localeChain(locale) {
	const chain = [];
	const add = (candidate) => {
		if (own(CATALOGS, candidate) && !chain.includes(candidate)) chain.push(candidate);
	};
	add(locale);
	add(locale.split("-")[0]);
	add("en");
	return chain;
}
function currentLocale() {
	try {
		const locale = activeLocale();
		return typeof locale === "string" && locale ? locale : "en";
	} catch {
		return "en";
	}
}
var PLACEHOLDER = /\{\{\s*(\w+)\s*\}\}/g;
function pluralForm(locale, count) {
	try {
		return new Intl.PluralRules(locale).select(count);
	} catch {
		return count === 1 ? "one" : "other";
	}
}
function t(key, vars) {
	const count = vars && typeof vars.count === "number" ? vars.count : void 0;
	for (const locale of localeChain(currentLocale())) {
		const catalog = CATALOGS[locale];
		let text;
		if (count !== void 0) text = lookup(catalog, `${key}_${pluralForm(locale, count)}`) ?? lookup(catalog, `${key}_other`);
		text = text ?? lookup(catalog, key);
		if (text !== void 0) return text.replace(PLACEHOLDER, (whole, name) => vars && own(vars, name) ? String(vars[name]) : whole);
	}
	return key;
}
/** The dashboard's name for this helper, so the ported call sites read unchanged. */
var i18nT = t;
/**
* Date/time fields in the app's language, as the dashboard's `i18n/format.fmtDateFields`
* renders them: an explicit field set (`hour`, `minute`, `second`, ...) read in the
* host's active locale, never the browser's. `''` for a value that is not a date.
*/
function fmtDateFields(value, fields) {
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return "";
	try {
		return new Intl.DateTimeFormat(currentLocale(), fields).format(date);
	} catch {
		return new Intl.DateTimeFormat("en", fields).format(date);
	}
}
// src/FindingDetail.tsx
var QUEUED_PREFIX = "QUEUED:";
/** Tri-state gate flag: pass / fail / not-applicable. A missing flag is NOT a
*  failure — the perf track never runs the bug ladder, and showing a red X there
*  would misreport the run. */
function GateFlag({ label, value }) {
	return /* @__PURE__ */ jsxs("span", {
		className: "inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[11px]",
		children: [value === true ? /* @__PURE__ */ jsx(Check, {
			className: "lucide-inline text-ok",
			size: 13
		}) : value === false ? /* @__PURE__ */ jsx(X, {
			className: "lucide-inline text-danger",
			size: 13
		}) : /* @__PURE__ */ jsx(Minus, {
			className: "lucide-inline text-muted",
			size: 13
		}), label]
	});
}
function Row({ label, children }) {
	return /* @__PURE__ */ jsxs("div", {
		className: "flex gap-2 py-0.5 text-[12px]",
		children: [/* @__PURE__ */ jsx("span", {
			className: "w-28 shrink-0 text-muted",
			children: label
		}), /* @__PURE__ */ jsx("span", {
			className: "min-w-0 flex-1 break-words",
			children
		})]
	});
}
function FindingDetail({ fp }) {
	const { data, isLoading, error } = useQuery({
		queryKey: ["auto-improvement-finding", fp],
		queryFn: async () => (await getJson(`${API}/findings/${encodeURIComponent(fp)}`)).finding
	});
	if (isLoading) return /* @__PURE__ */ jsx("div", {
		className: "p-2 text-[12px] text-muted",
		children: i18nT("autoImprovement.loadingDetail")
	});
	if (error || !data) return /* @__PURE__ */ jsx("div", {
		className: "p-2 text-[12px] text-warn",
		children: i18nT("autoImprovement.detailUnavailable")
	});
	const cand = data.candidate;
	const gate = data.gate;
	const prUrl = data.pr && data.pr.startsWith("http") ? data.pr : "";
	const queued = data.pr && data.pr.startsWith(QUEUED_PREFIX) ? data.pr : "";
	return /* @__PURE__ */ jsxs("div", {
		className: "flex flex-col gap-3 rounded border border-border bg-card p-3",
		children: [
			cand?.signature ? /* @__PURE__ */ jsxs("div", { children: [/* @__PURE__ */ jsx("div", {
				className: "mb-1 text-[11px] uppercase tracking-wide text-muted",
				children: i18nT("autoImprovement.defectHeading")
			}), /* @__PURE__ */ jsx("p", {
				className: "text-[13px]",
				children: cand.signature
			})] }) : null,
			cand?.hypothesis ? /* @__PURE__ */ jsxs("div", { children: [/* @__PURE__ */ jsx("div", {
				className: "mb-1 text-[11px] uppercase tracking-wide text-muted",
				children: i18nT("autoImprovement.hypothesisHeading")
			}), /* @__PURE__ */ jsx("p", {
				className: "text-[13px]",
				children: cand.hypothesis
			})] }) : null,
			gate && Object.keys(gate).length > 0 ? /* @__PURE__ */ jsxs("div", { children: [
				/* @__PURE__ */ jsx("div", {
					className: "mb-1 text-[11px] uppercase tracking-wide text-muted",
					children: i18nT("autoImprovement.gateHeading")
				}),
				/* @__PURE__ */ jsxs("div", {
					className: "flex flex-wrap gap-1",
					children: [
						/* @__PURE__ */ jsx(GateFlag, {
							label: i18nT("apps.autoImprovement.findingDetail.red"),
							value: gate.red
						}),
						/* @__PURE__ */ jsx(GateFlag, {
							label: i18nT("apps.autoImprovement.findingDetail.green"),
							value: gate.green
						}),
						/* @__PURE__ */ jsx(GateFlag, {
							label: i18nT("apps.autoImprovement.findingDetail.staygreen"),
							value: gate.staygreen
						}),
						/* @__PURE__ */ jsx(GateFlag, {
							label: i18nT("apps.autoImprovement.findingDetail.build"),
							value: gate.build_ok
						}),
						/* @__PURE__ */ jsx(GateFlag, {
							label: i18nT("apps.autoImprovement.findingDetail.lint"),
							value: gate.lint_ok
						}),
						/* @__PURE__ */ jsx(GateFlag, {
							label: i18nT("apps.autoImprovement.findingDetail.collects"),
							value: gate.collected
						})
					]
				}),
				gate.detail ? /* @__PURE__ */ jsx("p", {
					className: "mt-1 text-[12px] text-muted",
					children: gate.detail
				}) : null,
				gate.failing_tests && gate.failing_tests.length > 0 ? /* @__PURE__ */ jsx("p", {
					className: "mt-1 text-[12px] text-danger",
					children: i18nT("autoImprovement.regressed", { tests: gate.failing_tests.slice(0, 5).join(", ") })
				}) : null
			] }) : null,
			/* @__PURE__ */ jsxs("div", { children: [
				cand?.reproducing_test?.test_path ? /* @__PURE__ */ jsx(Row, {
					label: i18nT("autoImprovement.reproTest"),
					children: /* @__PURE__ */ jsx("code", {
						className: "text-[11px]",
						children: cand.reproducing_test.test_path
					})
				}) : null,
				data.archive?.cycle !== void 0 ? /* @__PURE__ */ jsx(Row, {
					label: i18nT("autoImprovement.cycle"),
					children: data.archive.cycle
				}) : null,
				data.archive?.primary_delta ? /* @__PURE__ */ jsxs(Row, {
					label: i18nT("autoImprovement.delta"),
					children: [data.archive.primary_delta, data.archive.noise_band ? ` (band ${data.archive.noise_band})` : ""]
				}) : null,
				data.run?.base_sha ? /* @__PURE__ */ jsx(Row, {
					label: i18nT("autoImprovement.base"),
					children: /* @__PURE__ */ jsxs("code", {
						className: "text-[11px]",
						children: [
							data.run.branch,
							" @ ",
							data.run.base_sha.slice(0, 10)
						]
					})
				}) : null,
				/* @__PURE__ */ jsx(Row, {
					label: i18nT("autoImprovement.fingerprint"),
					children: /* @__PURE__ */ jsx("code", {
						className: "text-[11px]",
						children: data.fp
					})
				}),
				data.note ? /* @__PURE__ */ jsx(Row, {
					label: i18nT("autoImprovement.gateNote"),
					children: data.note
				}) : null
			] }),
			prUrl ? /* @__PURE__ */ jsx(Row, {
				label: i18nT("autoImprovement.colPr"),
				children: /* @__PURE__ */ jsxs("a", {
					href: prUrl,
					target: "_blank",
					rel: "noopener noreferrer",
					className: "inline-flex items-center gap-1 text-accent hover:underline",
					children: [prUrl, /* @__PURE__ */ jsx(ExternalLink, {
						className: "lucide-inline",
						size: 11
					})]
				})
			}) : queued ? /* @__PURE__ */ jsx(Row, {
				label: i18nT("autoImprovement.colPr"),
				children: /* @__PURE__ */ jsx(Badge, {
					variant: "warn",
					children: i18nT("autoImprovement.queuedOnly")
				})
			}) : null,
			data.history && data.history.length > 1 ? /* @__PURE__ */ jsxs("div", { children: [/* @__PURE__ */ jsx("div", {
				className: "mb-1 text-[11px] uppercase tracking-wide text-muted",
				children: i18nT("autoImprovement.historyHeading")
			}), /* @__PURE__ */ jsx("ol", {
				className: "flex flex-wrap items-center gap-1 text-[11px]",
				children: data.history.map((h, i) => /* @__PURE__ */ jsxs("li", {
					className: "flex items-center gap-1",
					children: [i > 0 ? /* @__PURE__ */ jsx("span", {
						className: "text-muted",
						children: "→"
					}) : null, /* @__PURE__ */ jsx("span", {
						className: "rounded border border-border px-1.5 py-0.5",
						children: h.status
					})]
				}, i))
			})] }) : null,
			data.diff ? /* @__PURE__ */ jsxs("details", { children: [/* @__PURE__ */ jsx("summary", {
				className: "cursor-pointer text-[12px] text-muted hover:text-accent",
				children: i18nT("autoImprovement.showDiff")
			}), /* @__PURE__ */ jsxs("pre", {
				className: "mt-1 max-h-72 overflow-auto rounded border border-border bg-card p-2 font-mono text-[11px] leading-snug",
				children: [data.diff, data.diffTruncated ? `\n\n… ${i18nT("autoImprovement.truncated")}` : ""]
			})] }) : null,
			data.prBody ? /* @__PURE__ */ jsxs("details", { children: [/* @__PURE__ */ jsx("summary", {
				className: "cursor-pointer text-[12px] text-muted hover:text-accent",
				children: i18nT("autoImprovement.showPrBody")
			}), /* @__PURE__ */ jsx("pre", {
				className: "mt-1 max-h-72 overflow-auto whitespace-pre-wrap rounded border border-border bg-card p-2 font-mono text-[11px] leading-snug",
				children: data.prBody
			})] }) : null
		]
	});
}
// src/NativeSelect.tsx
/**
* The fallback for `Select` on a host that does not export one: a plain native
* `<select>` with the same props, so the call sites do not branch.
*/
function NativeSelect({ options, optionLabels, value, onChange, clearLabel, disabled, "aria-label": ariaLabel, title, className }) {
	const emptyRow = clearLabel !== void 0 || !options.includes(value);
	return /* @__PURE__ */ jsxs("select", {
		value,
		onChange: (e) => onChange(e.target.value),
		disabled,
		"aria-label": ariaLabel,
		title,
		className: "text-sm px-2 py-1 rounded-md bg-[var(--bg-elevated)] border border-[var(--border)] text-[var(--text)]" + (className ? ` ${className}` : ""),
		children: [emptyRow && /* @__PURE__ */ jsx("option", {
			value: "",
			children: clearLabel ?? ""
		}), options.map((option, index) => /* @__PURE__ */ jsx("option", {
			value: option,
			children: optionLabels?.[index] ?? option
		}, option))]
	});
}
// src/hostSdk.ts
/**
* Host names added at App Kit level 1 or later, feature-detected.
*
* A named import of an export the host's module does not have fails the whole
* bundle at link time, so a host older than these seams would show a broken page
* instead of a slightly plainer one. These names are therefore read off namespace
* imports, each through an `in` check, and each has a local fallback. Names every
* supported host has are named-imported where they are used.
*/
/** The host's inline dropdown, or a native `<select>` on a host without one. */
var Select = ("Select" in ui ? ui.Select : void 0) ?? NativeSelect;
/** The host's App Kit seam level; 0 on a host older than the `APP_SDK_LEVEL` export. */
function hostSdkLevel() {
	const level = "APP_SDK_LEVEL" in sdk ? sdk.APP_SDK_LEVEL : void 0;
	return typeof level === "number" && Number.isInteger(level) ? level : 0;
}
// src/SetupPanel.tsx
/** Render one activity item as a single readable line. Exported for tests. */
function activityLine(a) {
	const time = a.t ? fmtDateFields(a.t * 1e3, {
		hour: "numeric",
		minute: "2-digit",
		second: "2-digit"
	}) : "";
	const body = (() => {
		if (a.error) return `error: ${a.error}`;
		if (a.note) return a.note;
		if (a.agent) {
			const { kind, tool, detail } = a.agent;
			const label = tool ? `${kind ?? "agent"}:${tool}` : kind ?? "agent";
			return detail ? `${label} — ${detail}` : label;
		}
		if (a.stage) {
			const extra = a.discovered !== void 0 ? " " + i18nT("autoImprovement.activityDiscovered", {
				discovered: a.discovered,
				fresh: a.fresh ?? 0
			}) : "";
			return `cycle ${a.cycle ?? "?"} · ${a.stage}${extra}`;
		}
		return JSON.stringify(a);
	})();
	return time ? `${time}  ${body}` : body;
}
async function postJson(path, body) {
	try {
		return await sendJson("POST", `${API}${path}`, body ?? {});
	} catch (err) {
		const data = refusalBody(err);
		if (err instanceof ApiError && data?.error) return data;
		throw err instanceof ApiError ? /* @__PURE__ */ new Error(`HTTP ${err.status}`) : err;
	}
}
function SetupPanel({ config }) {
	const ime = useImeGuard();
	const qc = useQueryClient();
	const configured = Boolean(config?.clone);
	const display = String(config?.target_display || config?.target_url || "");
	const [url, setUrl] = useState("");
	const [branch, setBranch] = useState(String(config?.branch || ""));
	const configBranch = String(config?.branch || "");
	useEffect(() => {
		setBranch(configBranch);
	}, [configBranch]);
	const { data: branchResp } = useQuery({
		queryKey: ["auto-improvement-branches", configured],
		queryFn: () => getJson(`${API}/branches`).catch(() => ({ branches: [] })),
		enabled: configured
	});
	const branches = branchResp?.branches ?? [];
	const clone = useMutation({
		mutationFn: (u) => postJson("/setup-clone", { url: u }),
		onSuccess: (r) => {
			if (r.ok) {
				qc.invalidateQueries({ queryKey: ["auto-improvement-config"] });
				qc.invalidateQueries({ queryKey: ["auto-improvement-branches"] });
			}
		}
	});
	const saveConfig = useMutation({
		mutationFn: (patch) => sendJson("PUT", `${API}/config`, patch).catch((err) => refusalBody(err)),
		onSuccess: () => qc.invalidateQueries({ queryKey: ["auto-improvement-config"] })
	});
	const directCommit = Boolean(config?.directCommit);
	const { data: run } = useQuery({
		queryKey: ["auto-improvement-run"],
		queryFn: () => getJson(`${API}/run`),
		refetchInterval: (q) => q.state.data?.status === "running" ? 3e3 : 15e3
	});
	const running = run?.status === "running";
	const startRun = useMutation({
		mutationFn: () => postJson("/run", {}),
		onSuccess: () => qc.invalidateQueries({ queryKey: ["auto-improvement-run"] })
	});
	const stopRun = useMutation({
		mutationFn: () => postJson("/run/stop", {}),
		onSuccess: () => qc.invalidateQueries({ queryKey: ["auto-improvement-run"] })
	});
	return /* @__PURE__ */ jsxs(Card, { children: [
		/* @__PURE__ */ jsxs(CardTitle, {
			className: "flex items-center gap-2",
			children: [/* @__PURE__ */ jsx(FolderGit2, {
				className: "lucide-inline",
				size: 15
			}), i18nT("autoImprovement.setupHeading")]
		}),
		/* @__PURE__ */ jsxs("div", {
			className: "flex flex-col gap-2",
			children: [
				/* @__PURE__ */ jsx("label", {
					className: "text-[13px] text-muted",
					children: i18nT("autoImprovement.repoLabel")
				}),
				/* @__PURE__ */ jsxs("div", {
					className: "flex items-center gap-2",
					children: [/* @__PURE__ */ jsx(Input, {
						value: url,
						onChange: (e) => setUrl(e.target.value),
						placeholder: i18nT("apps.autoImprovement.setupPanel.https_github_com_owner_repo"),
						className: "flex-1",
						"aria-label": i18nT("autoImprovement.repoLabel"),
						...ime.bindEnter({ onEnter: () => {
							if (url.trim()) clone.mutate(url.trim());
						} })
					}), /* @__PURE__ */ jsx(Btn, {
						primary: true,
						"aria-label": i18nT("autoImprovement.cloneBtn"),
						disabled: !url.trim() || clone.isPending,
						onClick: () => clone.mutate(url.trim()),
						children: clone.isPending ? /* @__PURE__ */ jsx(Loader2, {
							className: "lucide-inline animate-spin",
							size: 14
						}) : i18nT("autoImprovement.cloneBtn")
					})]
				}),
				clone.data?.error ? /* @__PURE__ */ jsx("p", {
					className: "text-[12px] text-warn",
					children: clone.data.error
				}) : null,
				configured ? /* @__PURE__ */ jsxs("p", {
					className: "text-[12px] text-muted",
					children: [
						i18nT("autoImprovement.currentRepo"),
						" ",
						/* @__PURE__ */ jsx("span", {
							className: "text-accent",
							children: display
						}),
						config?.clone ? /* @__PURE__ */ jsx(Badge, {
							variant: "ok",
							className: "ml-2",
							children: i18nT("autoImprovement.pushDisabled")
						}) : null
					]
				}) : null
			]
		}),
		configured && branches.length > 0 ? /* @__PURE__ */ jsxs("div", {
			className: "mt-3 flex flex-col gap-2",
			children: [
				/* @__PURE__ */ jsxs("label", {
					className: "flex items-center gap-1 text-[13px] text-muted",
					children: [/* @__PURE__ */ jsx(GitBranch, {
						className: "lucide-inline",
						size: 13
					}), i18nT("autoImprovement.branchLabel")]
				}),
				/* @__PURE__ */ jsx(Select, {
					options: branch && !branches.includes(branch) ? [branch, ...branches] : branches,
					value: branch,
					onChange: (v) => {
						setBranch(v);
						saveConfig.mutate({ branch: v });
					},
					clearLabel: i18nT("autoImprovement.branchDefault"),
					className: "h-7 text-[13px]",
					"aria-label": i18nT("autoImprovement.branchLabel")
				}),
				/* @__PURE__ */ jsxs("label", {
					className: "mt-1 flex items-start gap-2",
					children: [/* @__PURE__ */ jsx("input", {
						type: "checkbox",
						checked: directCommit,
						onChange: (e) => saveConfig.mutate({ directCommit: e.target.checked }),
						className: "mt-0.5",
						"aria-label": i18nT("autoImprovement.autocommitLabel")
					}), /* @__PURE__ */ jsxs("span", {
						className: "text-[13px]",
						children: [i18nT("autoImprovement.autocommitLabel"), /* @__PURE__ */ jsx("span", {
							className: "block text-[11px] text-muted",
							children: i18nT("autoImprovement.autocommitHint")
						})]
					})]
				})
			]
		}) : null,
		configured ? /* @__PURE__ */ jsxs("div", {
			className: "mt-4 flex items-center gap-3 border-t border-border pt-3",
			children: [running ? /* @__PURE__ */ jsxs(Btn, {
				danger: true,
				onClick: () => stopRun.mutate(),
				disabled: stopRun.isPending,
				children: [
					/* @__PURE__ */ jsx(Square, {
						className: "lucide-inline",
						size: 14
					}),
					" ",
					i18nT("autoImprovement.stopBtn")
				]
			}) : /* @__PURE__ */ jsxs(Btn, {
				primary: true,
				onClick: () => startRun.mutate(),
				disabled: startRun.isPending,
				children: [
					/* @__PURE__ */ jsx(Play, {
						className: "lucide-inline",
						size: 14
					}),
					" ",
					i18nT("autoImprovement.runBtn")
				]
			}), /* @__PURE__ */ jsx("span", {
				className: "text-[13px] text-muted",
				children: running ? i18nT("autoImprovement.runningStatus", {
					cycle: run?.cycle ?? 0,
					kept: run?.kept ?? 0,
					drafted: run?.drafted ?? 0
				}) : run?.status === "error" ? run?.error || i18nT("autoImprovement.runError") : i18nT("autoImprovement.idleStatus")
			})]
		}) : null,
		running && run?.activity && run.activity.length > 0 ? /* @__PURE__ */ jsx("div", {
			className: "mt-3 max-h-40 overflow-auto rounded border border-border bg-card p-2 font-mono text-[11px] text-muted",
			children: run.activity.slice(-30).map((item, i) => /* @__PURE__ */ jsx("div", {
				className: "whitespace-pre-wrap",
				children: activityLine(item)
			}, i))
		}) : null
	] });
}
// src/host/sendTurn.ts
/**
* The send-receipt contract this app needs from the dashboard's chat-core
* transport (`chat-core/transport/sendTurn.ts`), restated for a bundle: the
* dashboard module is not part of the App Kit, so the bundle cannot import it.
*
* One `POST /api/chat?ws=1` through a wire, bounded by `SEND_ABORT_MS`, and the
* answer read as a receipt. Never rejects; the caller branches on `status`:
*
* - `dispatched` / `queued`: the server took the message (`ok`, or `queued`).
* - `refused`: a non-2xx, a readable body with neither `ok` nor `queued`, or a
*   2xx an intermediary answered (a redirect that left `/api/chat` with a body
*   that is not JSON). Nothing was sent. `reason` is the server's explanation.
* - `unknown`: a 2xx whose body could not be read. The turn may well be running.
* - `response-late`: the deadline fired, or the wire said `indeterminate()`.
* - `transport-error`: the wire rejected with anything else.
*/
var SEND_ABORT_MS = 1e4;
var CHAT_ENDPOINT_PATH = "/api/chat";
function answeredByIntermediary(response) {
	if (!response.redirected) return false;
	try {
		return new URL(response.url ?? "", "http://localhost").pathname !== CHAT_ENDPOINT_PATH;
	} catch {
		return true;
	}
}
async function readSendReceipt(response) {
	let parsed;
	try {
		parsed = await response.json();
	} catch {
		parsed = void 0;
	}
	const readable = !!parsed && typeof parsed === "object" && !Array.isArray(parsed);
	const body = readable ? parsed : {};
	if (!response.ok) return {
		body,
		outcome: "refused"
	};
	if (!readable) return {
		body,
		outcome: answeredByIntermediary(response) ? "refused" : "unknown"
	};
	if (body.ok || body.queued) return {
		body,
		outcome: "accepted"
	};
	return {
		body,
		outcome: "refused"
	};
}
async function sendTurn(opts) {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), SEND_ABORT_MS);
	try {
		const { body, outcome } = await readSendReceipt(await opts.wire({
			message: opts.message,
			slot: opts.slot
		}, controller.signal));
		if (outcome === "refused") return {
			status: "refused",
			body,
			reason: typeof body.error === "string" ? body.error : void 0
		};
		if (outcome === "unknown") return {
			status: controller.signal.aborted ? "response-late" : "unknown",
			body
		};
		return {
			status: body.ok && !body.queued ? "dispatched" : "queued",
			body
		};
	} catch (e) {
		if (e instanceof DOMException && e.name === "AbortError") return {
			status: "response-late",
			body: {}
		};
		return {
			status: "transport-error",
			body: {}
		};
	} finally {
		clearTimeout(timeout);
	}
}
// src/host/chat.ts
function listChatFolders() {
	return getJson("/api/chat/folders");
}
/** `POST /api/chat/folders` at the top level, as the dashboard's `createChatFolder(name)`. */
function createChatFolder(name) {
	return sendJson("POST", "/api/chat/folders", {
		name,
		parent_id: ""
	});
}
/**
* `POST /api/chat/slots`, with the fields the dashboard's `createSlot` sent for this
* app: filed into the folder, titled at birth (the server pins the name, locking the
* background auto-titler out), the persistent memory contract, and no fresh session
* folder.
*/
async function createSlot(opts) {
	const slot = await sendJson("POST", "/api/chat/slots", opts);
	if (!slot || typeof slot.key !== "string" || !slot.key) throw new Error("Chat slot create returned no key");
	return slot;
}
async function deleteSlot(key) {
	await request("/api/chat/slots/" + encodeURIComponent(key), { method: "DELETE" });
}
/** One row of the slot's transcript; a deleted slot answers 404 (an `ApiError`). */
function slotDetail(key, limit = 1) {
	const query = new URLSearchParams({ limit: String(limit) });
	return getJson("/api/chat/slots/" + encodeURIComponent(key) + "?" + query);
}
/** Resolves when the slot still exists; rejects (404 for a deleted one) otherwise. */
async function probeSlotExists(key) {
	await slotDetail(key, 1);
}
/**
* Whether a refusal means the slot is GONE, the rule of the dashboard's
* `utils/thunkError.isMissingSlotError`: a numeric status decides (404, and only
* 404); without one, the message is read for a 404 or "not found".
*/
function isMissingSlotError(e) {
	if (e && typeof e === "object") {
		const { status } = e;
		if (typeof status === "number") return status === 404;
	}
	const msg = e instanceof Error ? e.message : String(e ?? "");
	return /\b404\b/.test(msg) || /not found/i.test(msg);
}
/**
* The seed's wire: one `POST /api/chat?ws=1` with the message and slot, resolving on
* every HTTP status so the receipt classifier reads a 4xx/5xx as a refusal, under the
* transport's deadline signal. A rejected fetch is passed through (`transport-error`),
* as the dashboard's own wire passes it; the seeder then asks the slot what happened.
*/
var seedWire = async (payload, signal) => {
	try {
		return await request("/api/chat?ws=1", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				message: payload.message,
				slot: payload.slot
			}),
			signal
		});
	} catch (e) {
		if (e instanceof ApiError) {
			const body = e.body;
			return {
				ok: false,
				json: async () => JSON.parse(body)
			};
		}
		throw e;
	}
};
function sendSeed(message, slot) {
	return sendTurn({
		message,
		slot,
		wire: seedWire
	});
}
// src/host/sha256Hex.ts
/**
* SHA-256 of a string's UTF-8 bytes, as 64 lowercase hex characters, computed
* SYNCHRONOUSLY.
*
* The platform's `crypto.subtle.digest` is the obvious tool and is not used on
* purpose: it is async, and the one caller (`storedName` in `ensureChatFolder.ts`)
* derives a folder name inside synchronous code paths that run during render. A
* folder name is derived rarely and from at most a few hundred bytes, so the cost
* of a pure-TypeScript compression loop is irrelevant, and a collision-resistant
* digest is what lets two long names that share a prefix be told apart without
* trusting a 32-bit tag.
*
* FIPS 180-4, straight from the specification; the test file checks the published
* vectors for the empty string and `abc`.
*/
var K = new Uint32Array([
	1116352408,
	1899447441,
	3049323471,
	3921009573,
	961987163,
	1508970993,
	2453635748,
	2870763221,
	3624381080,
	310598401,
	607225278,
	1426881987,
	1925078388,
	2162078206,
	2614888103,
	3248222580,
	3835390401,
	4022224774,
	264347078,
	604807628,
	770255983,
	1249150122,
	1555081692,
	1996064986,
	2554220882,
	2821834349,
	2952996808,
	3210313671,
	3336571891,
	3584528711,
	113926993,
	338241895,
	666307205,
	773529912,
	1294757372,
	1396182291,
	1695183700,
	1986661051,
	2177026350,
	2456956037,
	2730485921,
	2820302411,
	3259730800,
	3345764771,
	3516065817,
	3600352804,
	4094571909,
	275423344,
	430227734,
	506948616,
	659060556,
	883997877,
	958139571,
	1322822218,
	1537002063,
	1747873779,
	1955562222,
	2024104815,
	2227730452,
	2361852424,
	2428436474,
	2756734187,
	3204031479,
	3329325298
]);
var rotr = (x, n) => x >>> n | x << 32 - n;
function sha256Hex(text) {
	const bytes = new TextEncoder().encode(text);
	const bitLen = bytes.length * 8;
	const padded = new Uint8Array(bytes.length + 9 + 63 >> 6 << 6);
	padded.set(bytes);
	padded[bytes.length] = 128;
	const view = new DataView(padded.buffer);
	view.setUint32(padded.length - 4, bitLen >>> 0);
	view.setUint32(padded.length - 8, Math.floor(bitLen / 4294967296));
	const h = new Uint32Array([
		1779033703,
		3144134277,
		1013904242,
		2773480762,
		1359893119,
		2600822924,
		528734635,
		1541459225
	]);
	const w = /* @__PURE__ */ new Uint32Array(64);
	for (let off = 0; off < padded.length; off += 64) {
		for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4);
		for (let i = 16; i < 64; i++) {
			const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ w[i - 15] >>> 3;
			const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ w[i - 2] >>> 10;
			w[i] = w[i - 16] + s0 + w[i - 7] + s1 >>> 0;
		}
		let [a, b, c, d, e, f, g, hh] = h;
		for (let i = 0; i < 64; i++) {
			const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
			const ch = e & f ^ ~e & g;
			const t1 = hh + S1 + ch + K[i] + w[i] >>> 0;
			const t2 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + (a & b ^ a & c ^ b & c) >>> 0;
			hh = g;
			g = f;
			f = e;
			e = d + t1 >>> 0;
			d = c;
			c = b;
			b = a;
			a = t1 + t2 >>> 0;
		}
		h[0] = h[0] + a >>> 0;
		h[1] = h[1] + b >>> 0;
		h[2] = h[2] + c >>> 0;
		h[3] = h[3] + d >>> 0;
		h[4] = h[4] + e >>> 0;
		h[5] = h[5] + f >>> 0;
		h[6] = h[6] + g >>> 0;
		h[7] = h[7] + hh >>> 0;
	}
	let out = "";
	for (let i = 0; i < 8; i++) out += h[i].toString(16).padStart(8, "0");
	return out;
}
/**
* The fingerprint an over-long name carries in its tail: the first 128 bits of the
* SHA-256 of the whole trimmed name, as 32 hex characters. Collision-resistant, so two
* different names cannot be made to share a tail by choosing them; a 32-bit tag could.
*/
function nameTag(trimmed) {
	return sha256Hex(trimmed).slice(0, 32);
}
/**
* The name the server will actually store for `raw`.
*
* Within the limit that is the trimmed name itself. Over it, the server would cut
* the tail and keep the first 100 code points, which merges every name sharing that
* prefix into one folder. So the cut is made here instead, with the last 35 code
* points spent on ` (<nameTag of the whole trimmed name>)`: the result is exactly 100
* code points, so the server stores it verbatim and the next run's lookup matches,
* and two long names that differ anywhere get two different tails.
*/
function storedName(raw) {
	const trimmed = raw.trim();
	const points = [...trimmed];
	if (points.length <= 100) return trimmed;
	const tag = ` (${nameTag(trimmed)})`;
	return points.slice(0, 100 - tag.length).join("") + tag;
}
/** Rows only; a non-array response (an error envelope) yields nothing to match. */
function folderRows(value) {
	return Array.isArray(value) ? value : [];
}
/**
* A folder with this exact name under this exact parent. An absent `parent_id`
* is the top level.
*/
function folderAt(list, name, parentId) {
	return list.find((f) => f?.name === name && String(f?.parent_id ?? "") === parentId);
}
/**
* The id of the folder called `name` under `parentId`, created if it does not
* exist. `null` when the name is blank or a create answers without an id; a
* rejected `list` or `create` propagates.
*/
async function ensureChatFolder(opts) {
	const name = storedName(opts.name);
	if (!name) return null;
	const parentId = opts.parentId;
	const find = (rows) => parentId === void 0 ? rows.find((f) => f?.name === name) : folderAt(rows, name, parentId);
	let list = folderRows(opts.cached);
	let read = false;
	if (list.length === 0) {
		list = folderRows(await opts.list());
		read = true;
	}
	const hit = find(list);
	if (hit?.id) return hit.id;
	if (!read) {
		list = folderRows(await opts.list());
		const fresh = find(list);
		if (fresh?.id) return fresh.id;
	}
	const created = await opts.create(name, parentId ?? "");
	return created?.id ? created.id : null;
}
var SEED_PROBE_GAP_MS = 1e3;
/** The user-facing text of a seed that did not start: the dashboard's own "could not
*  start" copy, with the server's reason appended when it gave one. */
function seedFailureText(reason) {
	const base = i18nT("pages.chatPage.could_not_start_a_new_session");
	return reason ? `${base} (${reason})` : base;
}
/** What the slot says about the seed: it is there, the slot is still empty, the slot
*  is gone, or the server could not answer. */
async function probeSlot(slotKey) {
	try {
		const detail = await slotDetail(slotKey, 1);
		return (typeof detail.total === "number" ? detail.total : Array.isArray(detail.messages) ? detail.messages.length : 0) > 0 ? "landed" : "empty";
	} catch (e) {
		return isMissingSlotError(e) ? "gone" : "unknown";
	}
}
var sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/**
* Settle a seed's receipt into "ran" or "never ran". Only `never ran` may tear the
* slot down; see the module comment for why each status lands where it does.
*/
async function settleSeedReceipt(receipt, slotKey) {
	if (receipt.status === "refused") return {
		ran: false,
		reason: seedFailureText(receipt.reason)
	};
	if (receipt.status !== "transport-error" && receipt.status !== "response-late") return { ran: true };
	for (let attempt = 1;; attempt++) {
		const probe = await probeSlot(slotKey);
		if (probe === "landed" || probe === "unknown") return { ran: true };
		if (probe === "gone" || attempt >= 3) return {
			ran: false,
			reason: seedFailureText()
		};
		await sleep(SEED_PROBE_GAP_MS);
	}
}
// src/lib/agentSession.ts
/**
* How long a NEW session waits before the chat launcher opens it, on an older host.
*
* The launcher (`useChatLauncher().openChat({slotKey})`) opens `/chat?sid=<key>`.
* From App Kit level 2 the host's chat page waits (bounded) for its session list to
* show a slot the app just created before it opens it, so the app opens at once
* there. An older host keeps that `sid` only when its list already holds the slot,
* and a slot this app created moments earlier reaches the list through the gateway's
* create broadcast: measured on a capture gateway, an immediate open dropped the
* `sid` and stayed on the previously active chat, while the same open 1.5 s later
* landed on the new session. So below level 2 this is a bounded wait, not a barrier.
* A resumed session is already in the list and opens at once. Mutable only so the
* tests can set it to 0.
*/
var sessionOpenTiming = { newSessionSettleMs: 1500 };
/** The App Kit level whose chat launcher waits for a just-created session itself. */
var LAUNCHER_AWAITS_NEW_SESSION_LEVEL = 2;
/** One folder per target repository groups every session from its runs. */
var FOLDER_PREFIX = "Auto-Improve - ";
/** Keep slot titles short enough to read in the folder's session list. */
var TITLE_MAX = 48;
function truncate(s, max = TITLE_MAX) {
	return s.length > max ? s.slice(0, max).trimEnd() + "…" : s;
}
/** Strip a component down to something safe to put in a filename.
*
*  Path syntax is stripped rather than escaped: a run of dots collapses away
*  entirely instead of surviving as `..-..-`, which is what a naive
*  character-class filter leaves behind. */
function safeSegment(raw, fallback) {
	return raw.replace(/\.{2,}/g, "").replace(/[/\\]+/g, "-").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[.\-]+|[.\-]+$/g, "") || fallback;
}
/** A deterministic 8-hex-char fingerprint of a raw string.
*
*  `safeSegment` is LOSSY on purpose (it drops path syntax), so two distinct raw
*  values can collapse to the same safe segment — `team/service-api` and
*  `team-service/api` both become `team-service-api`. When that segment is a chat
*  session key, the collision RESUMES the wrong repository's conversation. Appending
*  this fingerprint of the RAW value makes the mapping injective again while keeping
*  the readable prefix and staying inside the `[A-Za-z0-9._-]` charset the backend
*  re-validates. FNV-1a, 32-bit prime (`Math.imul` truncates operands to 32-bit, so
*  the 64-bit prime would silently collapse — same caveat as `lib/widgetSlug.ts`);
*  no crypto properties needed, only collision resistance for distinct inputs. */
function fingerprint(raw) {
	let h = 2166136261;
	for (let i = 0; i < raw.length; i++) h = Math.imul(h ^ raw.charCodeAt(i), 16777619) >>> 0;
	const HEX = "0123456789abcdef";
	let out = "";
	for (let shift = 28; shift >= 0; shift -= 4) out += HEX[h >> shift & 15];
	return out;
}
/** A filename-safe, INJECTIVE encoding of a component: the readable safe segment
*  plus a fingerprint of the RAW input, so distinct raw values never share a key
*  even when their safe segments collide. */
function keySegment(raw, fallback) {
	return `${safeSegment(raw, fallback)}.${fingerprint(raw)}`;
}
/** Stable record key for a subject. Kind-namespaced so `finding/7` and `pr/7`
*  are different conversations, and REPO-namespaced so two repositories do not
*  share one.
*
*  The repo segment is not decoration. Session records live at the data ROOT, not
*  under the per-repository workspace (`store.sessions_dir`: "a chat session ...
*  may reference any repo, so it is not scoped to the active one"), so that root is
*  shared by every target the app is ever pointed at. Without the repo, discussing
*  repo A's PR #1 and then repo B's PR #1 resumes A's conversation about a
*  different pull request — and `ruler`/`run` subjects, whose ids are constants like
*  `current`, collided for EVERY repository at once.
*
*  The key becomes a filename on the backend, which validates it again and rejects
*  anything unsafe — this is the first of two gates, not the only one. */
function sessionKey(kind, id, repo) {
	return `${kind}-${keySegment(repo, "norepo")}-${keySegment(String(id), "unknown")}`;
}
async function loadRecord(key) {
	try {
		return (await getJson(`/api/apps/auto-improvement/sessions/${encodeURIComponent(key)}`)).session ?? null;
	} catch {
		return null;
	}
}
async function saveRecord(key, patch) {
	try {
		return (await sendJson("PUT", `/api/apps/auto-improvement/sessions/${encodeURIComponent(key)}`, patch)).session ?? null;
	} catch {
		return null;
	}
}
/** Resolve the "Auto-Improve - <repo>" folder id, creating it on first use.
*  Matched by name because folders have no upsert endpoint. A rejected list or
*  create propagates untouched; a create that answers without an id throws, so the
*  `Promise<string>` contract holds without a silent `undefined` folder id. */
async function resolveFolderId(repo) {
	const id = await ensureChatFolder({
		list: () => listChatFolders(),
		create: (name) => createChatFolder(name),
		name: `${FOLDER_PREFIX}${repo}`
	});
	if (!id) throw new Error("Chat folder create returned no id");
	return id;
}
function useAgentSession() {
	const { openChat } = useChatLauncher();
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState(null);
	const inFlight = useRef(/* @__PURE__ */ new Set());
	return {
		openSession: useCallback(async ({ kind, id, repo, title, prompt, url }) => {
			const key = sessionKey(kind, id, repo);
			if (inFlight.current.has(key)) return null;
			inFlight.current.add(key);
			setBusy(true);
			setError(null);
			let createdSlotKey = null;
			try {
				const existing = await loadRecord(key);
				if (existing?.slot_key) {
					let resumed = false;
					try {
						await probeSlotExists(existing.slot_key);
						resumed = true;
					} catch (e) {
						if (!isMissingSlotError(e)) throw e;
					}
					if (resumed) {
						openChat({ slotKey: existing.slot_key });
						return existing;
					}
				}
				const folderId = await resolveFolderId(repo);
				const slot = await createSlot({
					folder_id: folderId,
					title: truncate(title),
					memory_mode: "persistent",
					no_session_folder: true
				});
				createdSlotKey = slot.key;
				const seedInFlight = sendSeed(prompt, slot.key);
				createdSlotKey = null;
				const verdict = await settleSeedReceipt(await seedInFlight, slot.key);
				if (!verdict.ran) {
					await deleteSlot(slot.key).catch(() => {});
					throw new Error(verdict.reason);
				}
				const record = await saveRecord(key, {
					slot_key: slot.key,
					folder_id: folderId,
					status: "open",
					subject: String(id),
					title,
					url
				});
				if (hostSdkLevel() < LAUNCHER_AWAITS_NEW_SESSION_LEVEL && sessionOpenTiming.newSessionSettleMs > 0) await new Promise((resolve) => setTimeout(resolve, sessionOpenTiming.newSessionSettleMs));
				openChat({ slotKey: slot.key });
				return record;
			} catch (e) {
				if (createdSlotKey) await deleteSlot(createdSlotKey).catch(() => {});
				setError(e);
				return null;
			} finally {
				inFlight.current.delete(key);
				setBusy(false);
			}
		}, [openChat]),
		busy,
		error
	};
}
// src/lib/prompts.ts
/** The non-negotiables appended to every seed prompt. */
var CONSTRAINTS = ["Constraints: this pull request is a DRAFT by design — never publish it, mark it ready for review, merge it, or enable auto-merge; that is the human's call.", "Never edit the ruler, the measurement harness, or the tests-of-record to make a number look better. If the measurement seems wrong, say so and explain why rather than changing it."].join("\n");
function prPrompt(pr) {
	const lines = [
		`Help me land this draft pull request: ${pr.url}`,
		"",
		`Title: ${pr.title}`
	];
	if (pr.verdict) lines.push(`Current state: ${pr.verdict}${pr.verdictReason ? ` — ${pr.verdictReason}` : ""}`);
	if (pr.checks) lines.push(`CI checks: ${pr.checks}`);
	if (pr.mergeable) lines.push(`Mergeability: ${pr.mergeable}`);
	lines.push("", "This PR was drafted by the auto-improvement loop, which already verified the change and reproduced its result independently. Your job is what is left: read the current CI state and review threads, fix what is genuinely failing, and rebase if it conflicts.", "", "Start by telling me what is actually blocking it, before changing anything.", "", CONSTRAINTS);
	return lines.join("\n");
}
function findingPrompt(f) {
	const lines = [
		`Let's go through this auto-improvement finding: ${f.target}`,
		"",
		`Track: ${f.kind}`,
		`Status: ${f.status}`,
		`Fingerprint: ${f.fingerprint}`
	];
	if (f.note) lines.push(`Note: ${f.note}`);
	if (f.pr) lines.push(`Pull request: ${f.pr}`);
	lines.push("", "I want to understand whether this result is believable, not just whether the tests passed. Walk me through the evidence the loop recorded: what was measured, how big the change was relative to the noise band, and what the gate checked.", "", "If the evidence is thin or the win is inside the noise band, say so plainly — a finding that should be discarded is a useful answer.", "", CONSTRAINTS);
	return lines.join("\n");
}
function rulerPrompt(r) {
	const lines = [
		"Let's review the ruler — the metric this project measures improvements with.",
		"",
		`Status: ${r.status}`
	];
	if (r.primary) lines.push(`Primary metric: ${r.primary}`);
	if (r.noiseBand) lines.push(`Noise band: ${r.noiseBand}`);
	if (r.canary) lines.push(`Canary: ${r.canary}`);
	lines.push("", "The loop refuses to optimize against a metric it cannot trust, so this is the gate everything else depends on. Help me judge it: is the noise band realistic for this harness, does the canary actually prove the ruler can detect a known win, and is the primary metric attributable to a named stage rather than a whole-system average?", "", "If the ruler is not trustworthy, tell me what would make it measurable instead of suggesting we proceed anyway.", "", CONSTRAINTS);
	return lines.join("\n");
}
// src/AutoImprovementPage.tsx
/** How many ledger rows the findings list renders.
*
*  The ledger grows without bound, and every expanded row mounts a detail query, so
*  the list is capped. The cap is named rather than inlined because the count has to
*  be shown to the reader — a silent cap under a stat card reporting the FULL count
*  is just two numbers that disagree. */
var FINDINGS_SHOWN = 40;
/** Catalog key per ledger status, so the row shows prose instead of `failed_gate`.
*
*  A STATIC map rather than an assembled `autoImprovement.status_${s}`: `dynamicKeys`
*  forbids building a key, and `check-i18n-keys` resolves a map's values as a finite set —
*  so every label here is verified to exist. Statuses come from `spine/ledger.py`'s
*  `VALID_STATUSES`; an unknown one falls back to the raw token, which is better than
*  rendering a dotted key path. */
var STATUS_LABEL_KEY = {
	seen: "autoImprovement.statusSeen",
	filed: "autoImprovement.statusFiled",
	committed: "autoImprovement.statusCommitted",
	discarded_noise: "autoImprovement.statusDiscardedNoise",
	failed_gate: "autoImprovement.statusFailedGate",
	failed_verify: "autoImprovement.statusFailedVerify",
	duplicate: "autoImprovement.statusDuplicate",
	error: "autoImprovement.statusError",
	no_defect: "autoImprovement.statusNoDefect",
	purged: "autoImprovement.statusPurged"
};
/** Ledger statuses that mean a change is queued and can still be committed. */
var DRAFTED_STATUSES = /* @__PURE__ */ new Set(["filed"]);
/** Already landed on the branch — there is nothing left to commit, only to view. */
var COMMITTED_STATUS = "committed";
/** A short commit sha, as the direct-commit path records it in the ledger's `cr`. */
var SHA_RE = /^[0-9a-f]{7,40}$/i;
/** The GitHub URL for a committed finding's sha, or null when we cannot build one.
*
*  The direct-commit path stores a bare sha (e.g. `1537c449`) rather than a url, so
*  the generic `prUrlOf` — which only accepts `http…` — rendered NOTHING for a
*  committed finding and the row instead showed a re-commit button. `repo` is the
*  `owner/name` display string the config already carries. */
function commitUrlOf(finding, repo) {
	const sha = (finding.pr || finding.cr || "").trim();
	if (!SHA_RE.test(sha)) return null;
	if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) return null;
	return `https://github.com/${repo}/commit/${sha}`;
}
/** Map a watcher verdict onto the shared badge vocabulary. */
function verdictVariant(verdict) {
	if (verdict === "READY") return "ok";
	if (verdict === "BLOCKED") return "err";
	if (verdict === "PROGRESS") return "warn";
	return "muted";
}
/** A PR url stored on a ledger row, when it is a real url rather than a queue id.
*
*  Reads BOTH keys on purpose: the spine's ledger field is historically named
*  `cr` (the app was ported from a change-request world), so a UI that only read
*  `pr` never rendered a link even once a pull request existed. */
function prUrlOf(finding) {
	const pr = finding.pr || finding.cr || "";
	return pr.startsWith("http") ? pr : null;
}
/** The `/pr-status` path plus its encoded query, as one string. */
function prStatusQuery(url) {
	return "/pr-status?" + new URLSearchParams({ url });
}
/** Badge tone for a ledger status, so the list is scannable at a glance. */
function statusVariant(status) {
	if (status === "filed" || status === "committed") return "ok";
	if (status === "failed_gate" || status === "failed_verify" || status === "error") return "err";
	if (status === "discarded_noise" || status === "no_defect") return "warn";
	return "muted";
}
function PrRow({ finding, repo }) {
	const url = prUrlOf(finding);
	const { openSession, busy } = useAgentSession();
	const { data, refetch, isFetching } = useQuery({
		queryKey: ["auto-improvement-pr", url],
		queryFn: () => getJson(`${API}${prStatusQuery(url)}`),
		enabled: Boolean(url),
		refetchInterval: 6e4
	});
	if (!url) return null;
	const discuss = () => openSession({
		kind: "pr",
		id: data?.number ?? finding.fp,
		repo,
		title: `${i18nT("autoImprovement.prTitlePrefix")} #${data?.number ?? "?"} · ${truncate(data?.title || finding.target, 32)}`,
		url,
		prompt: prPrompt({
			number: data?.number ?? 0,
			title: data?.title || finding.target,
			url,
			verdict: data?.verdict,
			verdictReason: data?.verdictReason,
			checks: data?.checks?.label,
			mergeable: data?.mergeable
		})
	});
	return /* @__PURE__ */ jsxs("tr", {
		className: "border-t border-border",
		children: [
			/* @__PURE__ */ jsx("td", {
				className: "py-2 pr-3 align-top",
				children: /* @__PURE__ */ jsxs("a", {
					href: url,
					target: "_blank",
					rel: "noopener noreferrer",
					className: "inline-flex items-center gap-1 text-[13px] text-accent hover:underline",
					children: [
						/* @__PURE__ */ jsx(GitPullRequest, {
							className: "lucide-inline",
							size: 14
						}),
						data?.number ? `#${data.number}` : i18nT("autoImprovement.draftPr"),
						/* @__PURE__ */ jsx(ExternalLink, {
							className: "lucide-inline",
							size: 12
						})
					]
				})
			}),
			/* @__PURE__ */ jsx("td", {
				className: "py-2 pr-3 align-top text-[13px]",
				children: data?.title || finding.target
			}),
			/* @__PURE__ */ jsx("td", {
				className: "py-2 pr-3 align-top",
				children: data?.ok === false ? /* @__PURE__ */ jsx(Badge, {
					variant: "muted",
					children: i18nT("autoImprovement.statusUnavailable")
				}) : /* @__PURE__ */ jsx(Badge, {
					variant: verdictVariant(data?.verdict),
					children: data?.verdict || "—"
				})
			}),
			/* @__PURE__ */ jsxs("td", {
				className: "py-2 pr-3 align-top text-[13px] text-muted",
				children: [data?.checks?.label || "—", data?.verdictReason ? /* @__PURE__ */ jsx("div", {
					className: "text-[11px] opacity-80",
					children: data.verdictReason
				}) : null]
			}),
			/* @__PURE__ */ jsx("td", {
				className: "py-2 align-top",
				children: /* @__PURE__ */ jsxs("div", {
					className: "flex items-center gap-1",
					children: [/* @__PURE__ */ jsx(Clickable, {
						onClick: () => refetch(),
						"aria-label": i18nT("autoImprovement.refreshPr"),
						title: i18nT("autoImprovement.refreshPr"),
						className: "rounded p-1 hover:bg-accent/20",
						children: /* @__PURE__ */ jsx(RefreshCw, {
							className: `lucide-inline ${isFetching ? "animate-spin" : ""}`,
							size: 14
						})
					}), /* @__PURE__ */ jsx(Clickable, {
						onClick: discuss,
						"aria-label": i18nT("autoImprovement.discussPr"),
						title: i18nT("autoImprovement.discussPr"),
						className: "rounded p-1 hover:bg-accent/20",
						children: /* @__PURE__ */ jsx(MessageSquare, {
							className: `lucide-inline ${busy ? "opacity-50" : ""}`,
							size: 14
						})
					})]
				})
			})
		]
	});
}
function AutoImprovementPage() {
	const { openSession } = useAgentSession();
	const [expanded, setExpanded] = useState(null);
	const { data: config } = useQuery({
		queryKey: ["auto-improvement-config"],
		queryFn: () => getJson(`${API}/config`)
	});
	const { data: ruler } = useQuery({
		queryKey: ["auto-improvement-ruler"],
		queryFn: () => getJson(`${API}/ruler`),
		refetchInterval: 3e4
	});
	const { data: findingsResp } = useQuery({
		queryKey: ["auto-improvement-findings"],
		queryFn: () => getJson(`${API}/findings`),
		refetchInterval: 3e4
	});
	const qc = useQueryClient();
	const findings = findingsResp?.findings ?? [];
	const repo = String(config?.target_display || config?.target_url || "repository");
	const branch = String(config?.branch || "").replace(/^origin\//, "") || "default";
	const calibrated = ruler?.status === "calibrated";
	const drafted = findings.filter((f) => DRAFTED_STATUSES.has(f.status));
	const withPr = drafted.filter((f) => prUrlOf(f));
	const commitFinding = useMutation({
		mutationFn: async (fp) => {
			let body;
			try {
				body = await sendJson("POST", `${API}/findings/${encodeURIComponent(fp)}/commit`);
			} catch (err) {
				const refused = refusalBody(err);
				throw new Error(refused.error || (err instanceof ApiError ? `HTTP ${err.status}` : String(err)));
			}
			if (body.ok === false) throw new Error(body.error || "HTTP 200");
			return body;
		},
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ["auto-improvement-findings"] });
			qc.invalidateQueries({ queryKey: ["auto-improvement-finding"] });
		}
	});
	const discussRuler = () => openSession({
		kind: "ruler",
		id: "current",
		repo,
		title: i18nT("autoImprovement.rulerSessionTitle"),
		prompt: rulerPrompt({
			status: ruler?.status || "uncalibrated",
			primary: ruler?.primary?.label || ruler?.primary?.name,
			noiseBand: ruler?.noiseBand?.value !== void 0 ? `${ruler.noiseBand.value}${ruler.noiseBand.unit || ""}` : void 0,
			canary: ruler?.canary?.result
		})
	});
	return /* @__PURE__ */ jsxs("div", {
		className: "mx-auto flex w-full max-w-[1100px] flex-col gap-4 p-4",
		children: [
			/* @__PURE__ */ jsxs("header", {
				className: "flex items-center gap-2",
				children: [/* @__PURE__ */ jsx(Brain, {
					className: "lucide-inline",
					size: 20
				}), /* @__PURE__ */ jsx("h1", {
					className: "text-[17px] font-semibold",
					children: i18nT("autoImprovement.title")
				})]
			}),
			/* @__PURE__ */ jsx("p", {
				className: "text-[13px] text-muted",
				children: i18nT("autoImprovement.intro")
			}),
			/* @__PURE__ */ jsx(SetupPanel, { config }),
			/* @__PURE__ */ jsxs("div", {
				className: "grid grid-cols-2 gap-3 sm:grid-cols-4",
				children: [
					/* @__PURE__ */ jsx(StatCard, {
						label: i18nT("autoImprovement.rulerStat"),
						value: calibrated ? i18nT("autoImprovement.calibrated") : i18nT("autoImprovement.uncalibrated"),
						colorClass: calibrated ? void 0 : "text-warn"
					}),
					/* @__PURE__ */ jsx(StatCard, {
						label: i18nT("autoImprovement.findingsStat"),
						value: findings.length
					}),
					/* @__PURE__ */ jsx(StatCard, {
						label: i18nT("autoImprovement.keptStat"),
						value: drafted.length
					}),
					/* @__PURE__ */ jsx(StatCard, {
						label: i18nT("autoImprovement.prStat"),
						value: withPr.length
					})
				]
			}),
			/* @__PURE__ */ jsxs(Card, { children: [/* @__PURE__ */ jsxs("div", {
				className: "flex items-center justify-between gap-2",
				children: [/* @__PURE__ */ jsxs(CardTitle, {
					className: "flex items-center gap-2",
					children: [/* @__PURE__ */ jsx(Ruler, {
						className: "lucide-inline",
						size: 15
					}), i18nT("autoImprovement.rulerHeading")]
				}), /* @__PURE__ */ jsx(Clickable, {
					onClick: discussRuler,
					"aria-label": i18nT("autoImprovement.discussRuler"),
					title: i18nT("autoImprovement.discussRuler"),
					className: "rounded p-1 hover:bg-accent/20",
					children: /* @__PURE__ */ jsx(MessageSquare, {
						className: "lucide-inline",
						size: 14
					})
				})]
			}), calibrated ? /* @__PURE__ */ jsxs("p", {
				className: "text-[13px] text-muted",
				children: [ruler?.primary?.label || ruler?.primary?.name || i18nT("autoImprovement.rulerReady"), ruler?.noiseBand?.value !== void 0 ? ` · ${i18nT("autoImprovement.band")} ${ruler.noiseBand.value}${ruler.noiseBand.unit || ""}` : ""]
			}) : /* @__PURE__ */ jsx("p", {
				className: "text-[13px] text-muted",
				children: i18nT("autoImprovement.rulerNotReady")
			})] }),
			/* @__PURE__ */ jsxs(Card, { children: [/* @__PURE__ */ jsxs(CardTitle, {
				className: "flex items-center gap-2",
				children: [/* @__PURE__ */ jsx(GitPullRequest, {
					className: "lucide-inline",
					size: 15
				}), i18nT("autoImprovement.changesHeading")]
			}), withPr.length === 0 ? /* @__PURE__ */ jsx("p", {
				className: "text-[13px] text-muted",
				children: i18nT("autoImprovement.noPrs")
			}) : /* @__PURE__ */ jsxs("table", {
				className: "w-full text-left",
				children: [/* @__PURE__ */ jsx("thead", { children: /* @__PURE__ */ jsxs("tr", {
					className: "text-[11px] uppercase tracking-wide text-muted",
					children: [
						/* @__PURE__ */ jsx("th", {
							className: "pb-2 pr-3 font-medium",
							children: i18nT("autoImprovement.colPr")
						}),
						/* @__PURE__ */ jsx("th", {
							className: "pb-2 pr-3 font-medium",
							children: i18nT("autoImprovement.colChange")
						}),
						/* @__PURE__ */ jsx("th", {
							className: "pb-2 pr-3 font-medium",
							children: i18nT("autoImprovement.colVerdict")
						}),
						/* @__PURE__ */ jsx("th", {
							className: "pb-2 pr-3 font-medium",
							children: i18nT("autoImprovement.colChecks")
						}),
						/* @__PURE__ */ jsx("th", {
							className: "pb-2 font-medium",
							children: i18nT("autoImprovement.colActions")
						})
					]
				}) }), /* @__PURE__ */ jsx("tbody", { children: withPr.map((f) => /* @__PURE__ */ jsx(PrRow, {
					finding: f,
					repo
				}, f.fp)) })]
			})] }),
			/* @__PURE__ */ jsxs(Card, { children: [
				/* @__PURE__ */ jsxs("div", {
					className: "flex items-center justify-between gap-2",
					children: [/* @__PURE__ */ jsx(CardTitle, { children: i18nT("autoImprovement.findingsHeading") }), /* @__PURE__ */ jsxs("span", {
						className: "inline-flex items-center gap-1 text-[12px] text-muted",
						children: [
							/* @__PURE__ */ jsx(GitBranch, {
								className: "lucide-inline",
								size: 12
							}),
							/* @__PURE__ */ jsx("span", {
								className: "text-accent",
								children: repo
							}),
							/* @__PURE__ */ jsx("span", { children: "@" }),
							/* @__PURE__ */ jsx("span", {
								className: "text-accent",
								children: branch
							})
						]
					})]
				}),
				findings.length === 0 ? /* @__PURE__ */ jsx("p", {
					className: "text-[13px] text-muted",
					children: i18nT("autoImprovement.noFindings")
				}) : /* @__PURE__ */ jsx("ul", {
					className: "flex flex-col gap-1",
					children: findings.slice(0, FINDINGS_SHOWN).map((f) => /* @__PURE__ */ jsxs("li", {
						className: "flex flex-col gap-1 py-1 text-[13px]",
						children: [
							/* @__PURE__ */ jsxs("div", {
								className: "flex items-center justify-between gap-2",
								children: [/* @__PURE__ */ jsxs(Clickable, {
									onClick: () => setExpanded(expanded === f.fp ? null : f.fp),
									"aria-label": i18nT("autoImprovement.toggleDetail"),
									"aria-expanded": expanded === f.fp,
									className: "flex min-w-0 flex-1 items-center gap-1 rounded text-left hover:bg-accent/10",
									children: [
										expanded === f.fp ? /* @__PURE__ */ jsx(ChevronDown, {
											className: "lucide-inline shrink-0",
											size: 13
										}) : /* @__PURE__ */ jsx(ChevronRight, {
											className: "lucide-inline shrink-0",
											size: 13
										}),
										/* @__PURE__ */ jsx(Badge, {
											variant: statusVariant(f.status),
											children: f.kind
										}),
										/* @__PURE__ */ jsx("span", {
											className: "ml-1 min-w-0 truncate",
											children: f.target
										})
									]
								}), /* @__PURE__ */ jsxs("span", {
									className: "flex shrink-0 items-center gap-2",
									children: [
										prUrlOf(f) ? /* @__PURE__ */ jsxs("a", {
											href: prUrlOf(f),
											target: "_blank",
											rel: "noopener noreferrer",
											className: "inline-flex items-center gap-1 text-[12px] text-accent hover:underline",
											children: [/* @__PURE__ */ jsx(GitPullRequest, {
												className: "lucide-inline",
												size: 12
											}), i18nT("autoImprovement.viewPr")]
										}) : null,
										/* @__PURE__ */ jsx("span", {
											className: "text-muted",
											children: STATUS_LABEL_KEY[f.status] ? i18nT(STATUS_LABEL_KEY[f.status]) : f.status
										}),
										f.status === COMMITTED_STATUS && commitUrlOf(f, repo) ? /* @__PURE__ */ jsxs("a", {
											href: commitUrlOf(f, repo),
											target: "_blank",
											rel: "noopener noreferrer",
											"aria-label": i18nT("autoImprovement.viewCommit"),
											title: i18nT("autoImprovement.viewCommit"),
											className: "inline-flex items-center gap-1 text-[12px] text-accent hover:underline",
											children: [/* @__PURE__ */ jsx(GitCommitVertical, {
												className: "lucide-inline",
												size: 13
											}), i18nT("autoImprovement.viewCommit")]
										}) : null,
										DRAFTED_STATUSES.has(f.status) ? /* @__PURE__ */ jsxs(Clickable, {
											onClick: () => {
												if (!window.confirm(i18nT("autoImprovement.commitConfirm", { branch }))) return;
												commitFinding.mutate(f.fp);
											},
											disabled: commitFinding.isPending,
											"aria-label": i18nT("autoImprovement.commitFinding"),
											title: i18nT("autoImprovement.commitFinding"),
											className: `inline-flex items-center rounded border border-border px-1.5 py-0.5 hover:bg-accent/20 ${commitFinding.isPending ? "cursor-not-allowed opacity-50" : ""}`,
											children: [/* @__PURE__ */ jsx(GitCommitVertical, {
												className: `lucide-inline ${commitFinding.isPending && commitFinding.variables === f.fp ? "animate-pulse" : ""}`,
												size: 13
											}), /* @__PURE__ */ jsx("span", {
												className: "ml-1 text-[12px]",
												children: i18nT("autoImprovement.commitFinding")
											})]
										}) : null,
										/* @__PURE__ */ jsx(Clickable, {
											onClick: () => openSession({
												kind: "finding",
												id: f.fp,
												repo,
												title: `${i18nT("autoImprovement.findingTitlePrefix")} ${truncate(f.target, 32)}`,
												prompt: findingPrompt({
													fingerprint: f.fp,
													kind: f.kind,
													target: f.target,
													status: f.status,
													note: f.note,
													pr: prUrlOf(f) || void 0
												})
											}),
											"aria-label": i18nT("autoImprovement.discussFinding"),
											title: i18nT("autoImprovement.discussFinding"),
											className: "rounded p-1 hover:bg-accent/20",
											children: /* @__PURE__ */ jsx(MessageSquare, {
												className: "lucide-inline",
												size: 13
											})
										})
									]
								})]
							}),
							commitFinding.isError && commitFinding.variables === f.fp ? /* @__PURE__ */ jsx("p", {
								className: "text-[12px] text-warn",
								children: commitFinding.error?.message || i18nT("autoImprovement.commitFailed")
							}) : null,
							expanded === f.fp ? /* @__PURE__ */ jsx(FindingDetail, { fp: f.fp }) : null
						]
					}, f.fp))
				}),
				findings.length > FINDINGS_SHOWN ? /* @__PURE__ */ jsx("p", {
					className: "mt-1 text-[12px] text-muted",
					children: i18nT("autoImprovement.findingsTruncated", {
						shown: FINDINGS_SHOWN,
						total: findings.length
					})
				}) : null
			] })
		]
	});
}
// src/index.tsx
/**
* The bundle's entry: AppHost lazy-imports this module and renders its default
* export as the app's page.
*
* Two things happen here once, for the whole page. The host's permission-scoped
* API client becomes the transport every request goes through (`setTransport`),
* and the host's language generation is subscribed to, which repaints the page on
* a language switch: `t` reads the active locale at call time, and this
* component's re-render reaches every child.
*/
function AutoImprovementApp() {
	useLanguageGeneration();
	setTransport(useAppApi());
	return /* @__PURE__ */ jsx(AutoImprovementPage, {});
}
export { AutoImprovementApp as default };
