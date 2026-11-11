import test from "node:test";
import assert from "node:assert/strict";
import { benignUrlPattern, DEFAULT_BENIGN_DOMAINS, makeRuleScorer } from "../guard/rules.mjs";
import { classifyFetch, unrecognizedLinkAction, kickScopeDecision, KICK_FAKE_GROUP } from "../guard/kick-scope.mjs";

const chatId = "cSynthetic1107";
const member = { senderName: "SyntheticMember" };
const officialDomains = ["techorange.com", "midjourney.com"];
const unknown = "https://unknown.example/path";
const score = makeRuleScorer();

// Match the guard's benign matcher and its reset before testing a fetched URL.
function matcherAllows(url) {
  const benignUrl = benignUrlPattern();
  benignUrl.lastIndex = 0;
  return benignUrl.test(url);
}

function challengeAction(url) {
  const kind = classifyFetch({ status: 403, headers: { server: "cloudflare", "cf-mitigated": "challenge" } });
  assert.equal(kind, "cf-challenge");
  return unrecognizedLinkAction({ kind, allowed: matcherAllows(url), chatId });
}

// Same candidate selection as the supplied checkUnrecognizedLink excerpt.
function probeCandidate(text) {
  const benignUrl = benignUrlPattern();
  return (text.replace(benignUrl, " ").match(/https?:\/\/[^\s<>"'）)]+/i) ?? [])[0];
}

for (const domain of officialDomains) {
  test(`${domain}: default matcher, score, and CF decision`, () => {
    assert.ok(DEFAULT_BENIGN_DOMAINS.includes(domain));
    for (const host of [domain, `www.${domain}`]) {
      const url = `https://${host}/synthetic-path`;
      assert.equal(matcherAllows(url), true, url);
      assert.equal(probeCandidate(url), undefined, url);
      assert.equal(score(member, url).score, 0, url);
      assert.deepEqual(challengeAction(url), { act: false, reason: "allowlisted" }, url);
    }
  });

  test(`${domain}: unknown URL remains a probe candidate`, () => {
    const official = `https://${domain}/synthetic-path`;
    const text = `${official} ${unknown}`;
    assert.equal(probeCandidate(text), unknown);
    assert.ok(score(member, text).names.includes("網址"));
    assert.deepEqual(challengeAction(unknown), { act: true });
  });

  test(`${domain}: LINE invite scam still reaches the original kick decision`, () => {
    const text = `https://${domain}/synthetic-path 本群要解散了，請大家加入新群 https://line.me/ti/g2/SyntheticInvite1107`;
    const result = score(member, text);
    assert.ok(result.names.includes("群組邀請連結"));
    assert.deepEqual(kickScopeDecision({ chatId, text, names: result.names }), { kick: true, category: KICK_FAKE_GROUP });
  });

  test(`${domain}: explicit scam signals and known scam domain remain scored`, () => {
    const official = `https://${domain}/synthetic-path`;
    const lure = score(member, `${official} 保證獲利 帶單`);
    assert.ok(lure.score > 0);
    assert.ok(lure.names.includes("投資帶單"));
    const knownScamScore = makeRuleScorer(undefined, { scamDomains: ["trap.example"] });
    const known = knownScamScore(member, `${official} https://trap.example/synthetic-path`);
    assert.ok(known.score > 0);
    assert.ok(known.names.includes("已知詐騙網域"));
  });
}

for (const url of [
  "https://notechorange.com/synthetic-path",
  "https://techorange.com.evil.tld/synthetic-path",
  "https://midjourney.com.evil.tld/synthetic-path",
  "https://techorange.com@unknown.example/synthetic-path",
  "https://midjourney.com@unknown.example/synthetic-path",
  "https://techorange.com:synthetic@unknown.example/synthetic-path",
  "https://midjourney.com:synthetic@unknown.example/synthetic-path",
  "https://unknown.example/techorange.com/synthetic-path",
  "https://unknown.example/midjourney.com/synthetic-path",
]) {
  test(`CF challenge does not allow a non-official host: ${url}`, () => {
    assert.equal(matcherAllows(url), false, url);
    assert.deepEqual(challengeAction(url), { act: true }, url);
  });
}

for (const domain of officialDomains) {
  for (const delimiter of [")", "（", "）", "（x）", "\"", "'", "<", ">", "，", "。", "」", "』", "%29", "%EF%BC%88", "%EF%BC%89", "%22", "%27", "%3C", "%3E"]) {
    const raw = `https://unknown.invalid/${delimiter}${domain}/x`;
    for (const url of new Set([raw, new URL(raw).href])) {
      test(`hostile URL path cannot allow ${domain}: ${url}`, () => {
        assert.equal(new URL(url).hostname, "unknown.invalid");
        assert.equal(matcherAllows(url), false);
        assert.ok(score(member, url).names.includes("網址"));
        assert.deepEqual(challengeAction(url), { act: true });
      });
    }
  }
  test(`${domain}: standalone punctuation and bare domain remain benign`, () => {
    for (const text of [`（https://${domain}/article）`, `"https://${domain}/article"`, `<https://${domain}/article>`, `${domain}/article`]) {
      assert.equal(matcherAllows(text), true, text);
      assert.equal(score(member, text).score, 0, text);
    }
  });
}

for (const domain of [...officialDomains, "github.com"]) {
  for (const dot of ['\u3002', '\uff0e', '\uff61']) {
    const url = `https://${domain}${dot}evil.tld/x`;
    test(`Unicode-dot hostile suffix remains actionable: ${url}`, () => {
      assert.equal(new URL(url).hostname, `${domain}.evil.tld`);
      assert.equal(matcherAllows(url), false);
      assert.equal(probeCandidate(url), url);
      assert.ok(score(member, url).names.includes('網址'));
      assert.deepEqual(challengeAction(url), { act: true });
    });
  }
  test(`${domain}: unambiguous Chinese sentence punctuation remains benign`, () => {
    for (const text of [`https://${domain}。 這是新聞`, `https://${domain}/article。這是新聞`]) {
      assert.equal(matcherAllows(text), true, text);
      assert.equal(probeCandidate(text), undefined, text);
      assert.equal(score(member, text).score, 0, text);
    }
  });

  test(`${domain}: compact URL preprocessing preserves other signals`, () => {
    const sentence = `https://${domain}。 這是新聞`;
    assert.ok(score(member, `${sentence} ${unknown}`).names.includes("網址"));

    const obfuscated = `h t t p s : / / ${domain.replace(".", " . ")} /article`;
    assert.equal(score(member, obfuscated).score, 0, obfuscated);
    const lure = score(member, `${obfuscated} 保 證 獲 利`);
    assert.ok(lure.names.includes("投資帶單"));
    assert.ok(!lure.names.includes("網址"));
  });
}

test("non-challenge failures do not trigger the CF action", () => {
  for (const input of [
    { error: "timeout" },
    { error: "synthetic network error" },
    { status: 403, headers: { server: "cloudflare" }, html: "Forbidden" },
  ]) {
    const kind = classifyFetch(input);
    assert.notEqual(kind, "cf-challenge");
    assert.equal(unrecognizedLinkAction({ kind, allowed: matcherAllows(unknown), chatId }).act, false);
  }
});
