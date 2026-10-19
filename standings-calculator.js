"use strict";

const DEFAULT_TIE_BREAKERS = ["points", "goalDifference", "goalsFor"];
const DEFAULT_POINTS_SYSTEM = Object.freeze({ win: 3, draw: 1, loss: 0 });
const ALLOWED_TIE_BREAKERS = new Set([
    ...DEFAULT_TIE_BREAKERS,
    "headToHeadPoints",
    "headToHeadGoalDifference",
    "headToHeadGoalsFor",
    "fairPlayPoints"
]);

function teamForFixture(event, side) {
    const source = side === "home"
        ? (event?.homeTeam || event?.home || {})
        : (event?.awayTeam || event?.away || {});
    const name = event?.[`${side}TeamName`]
        || (typeof source === "string" ? source : source.name || source.teamName)
        || "";
    const id = event?.[`${side}TeamId`] || source.id || source.teamId || "";
    if (!String(name).trim()) return null;
    return {
        id: String(id || ""),
        name: String(name).trim(),
        logo: source.logo || source.badge || source.crest
            || event?.[`${side}TeamLogo`] || ""
    };
}

function statusText(event) {
    const status = event?.matchStatus || event?.status || {};
    return [
        typeof status === "string" ? status : "",
        status?.short,
        status?.type,
        status?.name,
        status?.status,
        event?.statusShort,
        event?.matchStatusShort
    ].filter(value => typeof value === "string").join(" ")
        .toLowerCase()
        .replace(/[\s-]+/g, "_");
}

function fixtureScore(event) {
    if (isStandingsFixtureExcluded(event)) return null;
    const status = statusText(event);
    if (!/(^|_)(ft|aet|pen|after_extra_time|finished|full_time|completed|complete|ended|end|awarded|walkover)(_|$)/.test(status)) {
        return null;
    }

    const scoreValue = value => {
        if (value && typeof value === "object") {
            value = value.current ?? value.fullTime ?? value.fulltime
                ?? value.final ?? value.ft ?? value.value ?? value.goals ?? value.score;
        }
        if (value == null || value === "") return null;
        const score = Number(value);
        return Number.isInteger(score) && score >= 0 ? score : null;
    };
    const home = scoreValue(
        event?.homeTeamScore ?? event?.homeTeamFtScore ?? event?.homeScore
        ?? event?.score?.fullTime?.home ?? event?.score?.fulltime?.home
        ?? event?.score?.home ?? event?.home?.score
    );
    const away = scoreValue(
        event?.awayTeamScore ?? event?.awayTeamFtScore ?? event?.awayScore
        ?? event?.score?.fullTime?.away ?? event?.score?.fulltime?.away
        ?? event?.score?.away ?? event?.away?.score
    );
    return home == null || away == null ? null : { home, away };
}

function isStandingsFixtureExcluded(event) {
    return /(^|_)(postponed|ppd|cancelled|canceled|abd|abandoned|suspended|delayed|not_played|void)(_|$)/
        .test(statusText(event));
}

function fixtureKickoffKey(event) {
    const timestamp = event?.timestamp;
    if (typeof timestamp === "number" && Number.isFinite(timestamp)) {
        return String(timestamp);
    }

    const kickoff = event?.kickoffUtc || event?.startTime || event?.dateTime;
    if (typeof kickoff === "string" && /[T ]\d{1,2}:\d{2}/.test(kickoff)) {
        const parsed = Date.parse(kickoff);
        if (Number.isFinite(parsed)) return String(parsed);
    }

    const date = event?.matchDate || event?.date;
    const time = event?.matchTime || event?.kickoffTime;
    if (typeof date === "string" && typeof time === "string" && time.trim()) {
        const parsed = Date.parse(`${date}T${time}`);
        if (Number.isFinite(parsed)) return String(parsed);
    }
    return "";
}

function deferIncompleteSynchronizedResults(fixtures) {
    const batches = new Map();
    fixtures.forEach(item => {
        if (isStandingsFixtureExcluded(item.event)) return;
        const kickoff = fixtureKickoffKey(item.event);
        if (!kickoff) return;
        const key = `${item.scope}:${kickoff}`;
        if (!batches.has(key)) batches.set(key, []);
        batches.get(key).push(item);
    });

    batches.forEach(batch => {
        if (!batch.some(item => !item.score)) return;
        batch.forEach(item => {
            if (item.score) item.countedScore = null;
        });
    });
}

function fixtureKey(event, homeTeam, awayTeam) {
    const id = event?.id ?? event?.apiId ?? event?.fixtureId;
    if (id != null && String(id).trim()) return `id:${String(id)}`;
    const date = event?.kickoffUtc || event?.startTime || event?.date || event?.matchDate || "";
    if (!date) return "";
    const keyFor = team => team.id || team.name.toLocaleLowerCase();
    return `${keyFor(homeTeam)}:${keyFor(awayTeam)}:${String(date)}`;
}

function filterFixturesForSeason(fixtures, season, from, to) {
    const seasonYears = String(season || "").match(/\b20\d{2}\b/g)?.map(Number);
    const fromYear = Number(String(from || "").slice(0, 4));
    const toYear = Number(String(to || "").slice(0, 4));
    const dateRangeYears = Array.from(
        { length: Math.max(1, toYear - fromYear + 1) },
        (_, index) => fromYear + index
    );
    const fromTime = Date.parse(`${from}T00:00:00Z`);
    const toTime = Date.parse(`${to}T00:00:00Z`);

    return (Array.isArray(fixtures) ? fixtures : []).filter(event => {
        const fixtureSeason = event?.leagueYear
            ?? event?.seasonName
            ?? event?.season?.name
            ?? event?.season?.year
            ?? event?.seasonYear
            ?? event?.season;
        const fixtureYears = String(fixtureSeason ?? "").match(/\b20\d{2}\b/g)?.map(Number) || [];
        if (fixtureYears.length > 1 && seasonYears?.length > 1
            && fixtureYears[0] !== seasonYears[0]) {
            return false;
        }
        if (fixtureYears.length === 1 && dateRangeYears.length
            && !dateRangeYears.includes(fixtureYears[0])) {
            return false;
        }

        const date = event?.kickoffUtc || event?.startTime || event?.date || event?.matchDate;
        const fixtureTime = date ? Date.parse(date) : NaN;
        if (Number.isFinite(fixtureTime)
            && ((Number.isFinite(fromTime) && fixtureTime < fromTime)
                || (Number.isFinite(toTime) && fixtureTime >= toTime))) {
            return false;
        }
        return true;
    });
}

function fixtureGroup(event) {
    const candidates = [
        event?.group?.name,
        event?.group?.groupName,
        event?.group,
        event?.groupName,
        event?.group_name,
        event?.leagueRound?.name,
        event?.leagueRound,
        event?.league_round?.name,
        event?.league_round,
        event?.roundInfo?.name,
        event?.round?.name,
        event?.round,
        event?.stage?.name,
        event?.stageName,
        event?.matchRound
    ];
    for (const candidate of candidates) {
        if (typeof candidate !== "string" && typeof candidate !== "number") continue;
        const value = String(candidate).trim();
        const match = value.match(/(?:group|grp|المجموعة|مجموعة)[\s_:-]*(?:stage[\s_:-]*)?([a-h]|\d{1,2})\b/i);
        if (match) return /^[a-z]$/i.test(match[1]) ? match[1].toUpperCase() : match[1];
        if (/^[a-h]$/i.test(value)) return value.toUpperCase();
    }
    return "";
}

function fixtureStage(event) {
    const value = event?.leagueRound?.name
        || event?.leagueRound
        || event?.league_round?.name
        || event?.league_round
        || event?.roundInfo?.name
        || event?.round?.name
        || event?.round
        || event?.stage?.name
        || event?.stageName
        || event?.matchRound
        || "";
    return typeof value === "string" || typeof value === "number"
        ? String(value).trim()
        : "";
}

function isGroupStage(event) {
    return /group[\s_-]*stage|دور المجموعات/i.test(fixtureStage(event));
}

function isKnockoutStage(stage, competitionName) {
    if (/final|semi[\s_-]*final|quarter[\s_-]*final|round[\s_-]*of|last[\s_-]*(?:16|32|64)|knockout|play[\s_-]*off|eighth[\s_-]*final|ثمن النهائي|ربع النهائي|نصف النهائي|النهائي/i.test(stage)) {
        return true;
    }
    return /cup|copa|coupe|pokal|coppa|taca|taça|trophy|كأس/i.test(competitionName)
        && /^(?:round|stage|دور)[\s_-]*\d+/i.test(stage);
}

function makeGroupAssignments(fixtures) {
    const parent = new Map();
    const root = key => {
        if (!parent.has(key)) parent.set(key, key);
        let current = key;
        while (parent.get(current) !== current) current = parent.get(current);
        let cursor = key;
        while (parent.get(cursor) !== cursor) {
            const next = parent.get(cursor);
            parent.set(cursor, current);
            cursor = next;
        }
        return current;
    };

    const groupFixtures = fixtures.filter(item => !item.explicitGroup && isGroupStage(item.event));
    groupFixtures.forEach(({ homeTeam, awayTeam }) => {
        const homeKey = homeTeam.id || homeTeam.name.toLocaleLowerCase();
        const awayKey = awayTeam.id || awayTeam.name.toLocaleLowerCase();
        const homeRoot = root(homeKey);
        const awayRoot = root(awayKey);
        if (homeRoot !== awayRoot) parent.set(awayRoot, homeRoot);
    });

    const components = new Map();
    groupFixtures.forEach(({ homeTeam, awayTeam }) => {
        [homeTeam, awayTeam].forEach(team => {
            const key = team.id || team.name.toLocaleLowerCase();
            const component = root(key);
            if (!components.has(component)) components.set(component, new Set());
            components.get(component).add(key);
        });
    });
    const sortedComponents = [...components.entries()].sort((left, right) => {
        const leftName = [...left[1]].sort()[0] || "";
        const rightName = [...right[1]].sort()[0] || "";
        return leftName.localeCompare(rightName, undefined, { sensitivity: "base" });
    });
    const byTeam = new Map();
    sortedComponents.forEach(([, teams], index) => {
        const label = String.fromCharCode(65 + (index % 26));
        teams.forEach(key => byTeam.set(key, label));
    });
    return byTeam;
}

function headToHeadStats(rows, fixtures, pointsSystem) {
    const keys = new Set(rows.map(row => row._key));
    const stats = new Map(rows.map(row => [
        row._key,
        { points: 0, goalsFor: 0, goalsAgainst: 0 }
    ]));
    fixtures.forEach(fixture => {
        if (!keys.has(fixture.homeKey) || !keys.has(fixture.awayKey)) return;
        const home = stats.get(fixture.homeKey);
        const away = stats.get(fixture.awayKey);
        home.goalsFor += fixture.score.home;
        home.goalsAgainst += fixture.score.away;
        away.goalsFor += fixture.score.away;
        away.goalsAgainst += fixture.score.home;
        if (fixture.score.home > fixture.score.away) {
            home.points += pointsSystem.win;
            away.points += pointsSystem.loss;
        } else if (fixture.score.home < fixture.score.away) {
            away.points += pointsSystem.win;
            home.points += pointsSystem.loss;
        } else {
            home.points += pointsSystem.draw;
            away.points += pointsSystem.draw;
        }
    });
    stats.forEach(stat => {
        stat.goalDifference = stat.goalsFor - stat.goalsAgainst;
    });
    return stats;
}

function ruleValue(row, rule, headToHead) {
    if (rule === "headToHeadPoints") return headToHead?.get(row._key)?.points ?? 0;
    if (rule === "headToHeadGoalDifference") return headToHead?.get(row._key)?.goalDifference ?? 0;
    if (rule === "headToHeadGoalsFor") return headToHead?.get(row._key)?.goalsFor ?? 0;
    if (rule === "fairPlayPoints") return row.fairPlayPoints;
    return Number(row[rule] || 0);
}

function sortStandings(rows, fixtures, rules, pointsSystem, ruleIndex = 0) {
    if (rows.length < 2 || ruleIndex >= rules.length) return rows;
    const rule = rules[ruleIndex];
    const headToHead = rule.startsWith("headToHead")
        ? headToHeadStats(rows, fixtures, pointsSystem)
        : null;
    const availableRows = rule === "fairPlayPoints"
        ? rows.filter(row => row.fairPlayPoints != null)
        : rows;
    if (availableRows.length < 2) return sortStandings(rows, fixtures, rules, pointsSystem, ruleIndex + 1);

    const ordered = [...availableRows].sort((left, right) => {
        const leftValue = ruleValue(left, rule, headToHead);
        const rightValue = ruleValue(right, rule, headToHead);
        if (leftValue == null || rightValue == null) return 0;
        return rule === "fairPlayPoints"
            ? Number(leftValue) - Number(rightValue)
            : Number(rightValue) - Number(leftValue);
    });
    const buckets = [];
    ordered.forEach(row => {
        const value = ruleValue(row, rule, headToHead);
        const last = buckets[buckets.length - 1];
        if (!last || ruleValue(last[0], rule, headToHead) !== value) buckets.push([row]);
        else last.push(row);
    });
    const ranked = buckets.flatMap(bucket => sortStandings(bucket, fixtures, rules, pointsSystem, ruleIndex + 1));
    if (availableRows.length !== rows.length) {
        const included = new Set(availableRows);
        ranked.push(...rows.filter(row => !included.has(row)));
    }
    return ranked;
}

function normalizePointsSystem(pointsSystem) {
    if (pointsSystem == null) return DEFAULT_POINTS_SYSTEM;
    for (const result of ["win", "draw", "loss"]) {
        if (!Number.isInteger(pointsSystem[result]) || pointsSystem[result] < 0) {
            throw new TypeError(`Invalid points value for ${result}`);
        }
    }
    return pointsSystem;
}

function calculateStandings(fixtures, options = {}) {
    const rules = Array.isArray(options.tieBreakers)
        ? options.tieBreakers.filter(rule => ALLOWED_TIE_BREAKERS.has(rule))
        : DEFAULT_TIE_BREAKERS;
    const selectedRules = rules.length ? rules : DEFAULT_TIE_BREAKERS;
    const pointsSystem = normalizePointsSystem(options.pointsSystem);
    const competitionName = String(options.leagueName || "");
    const excludedStages = new Set(
        (Array.isArray(options.excludedStages) ? options.excludedStages : [])
            .map(stage => String(stage).trim().toLocaleLowerCase())
            .filter(Boolean)
    );
    const uniqueFixtures = new Map();
    for (const event of Array.isArray(fixtures) ? fixtures : []) {
        const homeTeam = teamForFixture(event, "home");
        const awayTeam = teamForFixture(event, "away");
        if (!homeTeam || !awayTeam) continue;
        const key = fixtureKey(event, homeTeam, awayTeam);
        if (!key) continue;
        const score = fixtureScore(event);
        const existing = uniqueFixtures.get(key);
        if (!existing || (!existing.score && score)) {
            uniqueFixtures.set(key, {
                event,
                homeTeam,
                awayTeam,
                score,
                explicitGroup: fixtureGroup(event),
                stage: fixtureStage(event)
            });
        }
    }

    const eligibleFixtures = [...uniqueFixtures.values()].filter(item => {
        return !isStandingsFixtureExcluded(item.event)
            && !excludedStages.has(item.stage.toLocaleLowerCase());
    });
    const inferredGroups = makeGroupAssignments(eligibleFixtures);
    const buckets = new Map();
    eligibleFixtures.forEach(item => {
        const homeKey = item.homeTeam.id || item.homeTeam.name.toLocaleLowerCase();
        const awayKey = item.awayTeam.id || item.awayTeam.name.toLocaleLowerCase();
        const inferred = inferredGroups.get(homeKey);
        if (item.explicitGroup) {
            item.scope = `group:${item.explicitGroup}`;
            item.groupType = "group";
            item.groupName = `Group ${item.explicitGroup}`;
        } else if (isGroupStage(item.event) && inferred && inferredGroups.get(awayKey) === inferred) {
            item.scope = `group:${inferred}`;
            item.groupType = "group";
            item.groupName = `Group ${inferred}`;
        } else if (isKnockoutStage(
            item.stage,
            competitionName || item.event?.leagueName || item.event?.competitionName || ""
        )) {
            item.scope = `round:${item.stage}`;
            item.groupType = "round";
            item.groupName = item.stage;
        } else {
            item.scope = "league";
            item.groupType = "league";
            item.groupName = "الدوري";
        }
        item.countedScore = item.score;
    });
    deferIncompleteSynchronizedResults(eligibleFixtures);
    eligibleFixtures.forEach(item => {
        const homeKey = item.homeTeam.id || item.homeTeam.name.toLocaleLowerCase();
        const awayKey = item.awayTeam.id || item.awayTeam.name.toLocaleLowerCase();
        const { groupType: type, groupName: name } = item;
        const key = `${type}:${name}`;
        if (!buckets.has(key)) buckets.set(key, { name, fixtures: [], teams: new Map() });
        const bucket = buckets.get(key);
        bucket.fixtures.push(item);
        for (const team of [item.homeTeam, item.awayTeam]) {
            const teamKey = team.id || team.name.toLocaleLowerCase();
            if (!bucket.teams.has(teamKey)) {
                bucket.teams.set(teamKey, {
                    _key: teamKey,
                    team,
                    played: 0,
                    wins: 0,
                    draws: 0,
                    losses: 0,
                    goalsFor: 0,
                    goalsAgainst: 0,
                    goalDifference: 0,
                    points: 0,
                    fairPlayPoints: 0,
                    fairPlayKnown: true
                });
            }
        }
        if (!item.countedScore || homeKey === awayKey) return;
        const home = bucket.teams.get(homeKey);
        const away = bucket.teams.get(awayKey);
        home.played++;
        away.played++;
        home.goalsFor += item.countedScore.home;
        home.goalsAgainst += item.countedScore.away;
        away.goalsFor += item.countedScore.away;
        away.goalsAgainst += item.countedScore.home;
        if (item.countedScore.home > item.countedScore.away) {
            home.wins++;
            home.points += pointsSystem.win;
            away.losses++;
            away.points += pointsSystem.loss;
        } else if (item.countedScore.home < item.countedScore.away) {
            away.wins++;
            away.points += pointsSystem.win;
            home.losses++;
            home.points += pointsSystem.loss;
        } else {
            home.draws++;
            away.draws++;
            home.points += pointsSystem.draw;
            away.points += pointsSystem.draw;
        }
        bucket.fixtures[bucket.fixtures.length - 1].homeKey = homeKey;
        bucket.fixtures[bucket.fixtures.length - 1].awayKey = awayKey;
        const homeFairPlay = Number(
            item.event?.homeTeamFairPlayPoints
            ?? item.event?.homeFairPlayPoints
            ?? item.event?.homeTeam?.fairPlayPoints
            ?? item.event?.homeTeam?.disciplinaryPoints
        );
        const awayFairPlay = Number(
            item.event?.awayTeamFairPlayPoints
            ?? item.event?.awayFairPlayPoints
            ?? item.event?.awayTeam?.fairPlayPoints
            ?? item.event?.awayTeam?.disciplinaryPoints
        );
        if (!Number.isFinite(homeFairPlay)) home.fairPlayKnown = false;
        else home.fairPlayPoints += homeFairPlay;
        if (!Number.isFinite(awayFairPlay)) away.fairPlayKnown = false;
        else away.fairPlayPoints += awayFairPlay;
    });

    const standingsGroups = [...buckets.values()]
        .sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true }))
        .map(group => {
            const completedFixtures = group.fixtures.filter(item => item.countedScore).map(item => ({
                homeKey: item.homeKey,
                awayKey: item.awayKey,
                score: item.countedScore
            }));
            const rows = [...group.teams.values()];
            rows.forEach(row => {
                row.goalDifference = row.goalsFor - row.goalsAgainst;
                if (!row.fairPlayKnown) row.fairPlayPoints = null;
                delete row.fairPlayKnown;
            });
            const ranked = sortStandings(rows, completedFixtures, selectedRules, pointsSystem)
                .map((row, index) => ({
                    position: index + 1,
                    team: row.team,
                    played: row.played,
                    wins: row.wins,
                    draws: row.draws,
                    losses: row.losses,
                    goalsFor: row.goalsFor,
                    goalsAgainst: row.goalsAgainst,
                    goalDifference: row.goalDifference,
                    points: row.points
                }));
            return {
                name: group.name,
                complete: group.fixtures.every(item => Boolean(item.countedScore)),
                standings: ranked
            };
        });

    return {
        success: true,
        leagueId: String(options.leagueId || ""),
        season: String(options.season || ""),
        historical: false,
        calculated: true,
        tieBreakers: selectedRules,
        note: "ترتيب محسوب داخلياً من نتائج المباريات النهائية فقط.",
        standings: standingsGroups.flatMap(group => group.standings),
        standingsGroups
    };
}

module.exports = {
    calculateStandings,
    deferIncompleteSynchronizedResults,
    filterFixturesForSeason,
    isStandingsFixtureExcluded,
    DEFAULT_TIE_BREAKERS,
    DEFAULT_POINTS_SYSTEM,
    ALLOWED_TIE_BREAKERS
};
