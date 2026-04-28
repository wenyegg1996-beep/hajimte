import mongoose from 'mongoose';
import fetch from 'node-fetch';
import { env } from '../lib/env.js';

const DOMAIN_DEFINITIONS = [
  { domain: 'login_account', keywords: ['登录', '登不上', '登录失败', '无法登录', '密码', '验证码', '手机号', '邮箱', '账户', '账号', '绑定', '解锁'] },
  { domain: 'deposit', keywords: ['存款', '充值', '入款', '代存', '存送', '网银', '支付宝', '微信支付'] },
  { domain: 'withdrawal', keywords: ['取款', '提款', '出款', '到账', '预约提款', '取消提款'] },
  { domain: 'payment_crypto', keywords: ['usdt', '虚拟币', '币安', 'ebpay', '易币付', 'u存u提', 'trc20', 'erc20'] },
  { domain: 'sports_rules', keywords: ['盘口', '滚球', '大小球', '让球', '串关', '连串', '赔率', '派彩', '走水', '波胆', '规则'] },
  { domain: 'sports_settlement', keywords: ['结算', '赛果', '注单', '赛事中断', '取消', '危险球', '提前结算', '未结算'] },
  { domain: 'venue_issue', keywords: ['场馆', '真人', '电子', '维护', '无法进入', '转账失败', '负数', '余额'] },
  { domain: 'promo_activity', keywords: ['活动', '彩金', '红包雨', '返水', '优惠', '礼金', '升级', '生日礼金', '补偿', '补偿金', '赔偿', '补发', '安抚', '慰问'] },
  { domain: 'risk_control', keywords: ['风控', '审计', '冻结', '封号', '异常投注', '违规', '复审', '套利'] },
  { domain: 'internal_template', keywords: ['模板', '报备', '申请', '拉白', '下分', '代注册', '复审模板'] },
  { domain: 'general_policy', keywords: ['条款', '隐私', '规则与条款', '免责声明', '使用条件'] },
];

const INTENT_DOMAIN_MAP = {
  ACCOUNT_SECURITY: 'login_account',
  ACCOUNT_LOCK: 'risk_control',
  DEPOSIT_ISSUE: 'deposit',
  PROMO_CLAIM: 'promo_activity',
  GAME_RESULT: 'sports_settlement',
  SPORT_RULE: 'sports_rules',
  CASINO_RULE: 'venue_issue',
  COMPLAINT_AGENT: 'internal_template',
  COMPLAINT_HARASS: 'risk_control',
  OTHER: 'general_policy',
};

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeKeywordList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeString(String(item))).filter(Boolean);
  }

  const text = normalizeString(value);
  if (!text) return [];
  return text
    .split(/[,，/\n]/)
    .map((item) => normalizeString(item))
    .filter(Boolean);
}

function compactTextParts(parts) {
  return parts
    .map((part) => normalizeString(part))
    .filter(Boolean)
    .join('\n')
    .trim();
}

function splitLongText(name, text, maxSectionLength = 1400) {
  const clean = normalizeString(text);
  if (!clean) return [];

  const rawSections = clean
    .split(/\n{2,}/)
    .map((section) => section.trim())
    .filter(Boolean);

  if (clean.length <= maxSectionLength && rawSections.length <= 1) {
    return [{ title: name, content: clean }];
  }

  const sections = [];
  let current = '';
  let index = 1;

  for (const section of rawSections) {
    if (!current) {
      current = section;
      continue;
    }

    if ((current + '\n\n' + section).length <= maxSectionLength) {
      current += '\n\n' + section;
      continue;
    }

    sections.push({ title: `${name} #${index}`, content: current });
    index += 1;
    current = section;
  }

  if (current) sections.push({ title: `${name} #${index}`, content: current });
  return sections;
}

function inferDomainFromText(text, fallback = 'general_policy') {
  const lower = normalizeString(text).toLowerCase();
  if (!lower) return fallback;

  let best = { domain: fallback, score: 0 };
  for (const item of DOMAIN_DEFINITIONS) {
    let score = 0;
    for (const keyword of item.keywords) {
      if (lower.includes(keyword.toLowerCase())) score += keyword.length;
    }
    if (score > best.score) best = { domain: item.domain, score };
  }
  return best.domain;
}

function inferDomainFromCategory(category, keywords, content, fallback = 'general_policy') {
  const text = compactTextParts([category, keywords, content]);
  return inferDomainFromText(text, fallback);
}

function scoreLexicalMatch(doc, query) {
  const lowerQuery = normalizeString(query).toLowerCase();
  if (!lowerQuery) return 0;

  let score = 0;
  const title = normalizeString(doc.title).toLowerCase();
  const content = normalizeString(doc.content).toLowerCase();
  const keywordsText = normalizeString(doc.keywordsText).toLowerCase();
  const tagsText = normalizeString(doc.tagsText).toLowerCase();

  if (title.includes(lowerQuery)) score += 12;
  if (keywordsText.includes(lowerQuery)) score += 10;
  if (tagsText.includes(lowerQuery)) score += 8;
  if (content.includes(lowerQuery)) score += 4;

  for (const token of lowerQuery.split(/\s+/).filter(Boolean)) {
    if (title.includes(token)) score += 4;
    if (keywordsText.includes(token)) score += 3;
    if (tagsText.includes(token)) score += 2;
    if (content.includes(token)) score += 1;
  }

  return score;
}

async function embedText(text) {
  if (!env.GEMINI_API_KEY) {
    throw new Error('Missing GEMINI_API_KEY for RAG embeddings');
  }

  const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': env.GEMINI_API_KEY,
    },
    body: JSON.stringify({
      model: env.GEMINI_EMBEDDING_MODEL,
      task_type: 'RETRIEVAL_QUERY',
      output_dimensionality: 768,
      content: {
        parts: [{ text }],
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`Embedding request failed: ${response.status} ${await response.text()}`);
  }

  const data = await response.json();
  const values = data?.embedding?.values || data?.embeddings?.[0]?.values;
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error('Embedding API returned no vector values');
  }

  return values;
}

function buildVectorFilter({ domain, venue }) {
  const clauses = [{ enabled: { $ne: false } }];
  if (domain) clauses.push({ domain });
  if (venue) clauses.push({ venue });
  return clauses.length === 1 ? clauses[0] : { $and: clauses };
}

async function runAtlasTextSearch(collection, { query, domain, venue, limit }) {
  const mustClauses = [
    {
      text: {
        query,
        path: ['title', 'content', 'keywordsText', 'tagsText'],
        fuzzy: { maxEdits: 1, prefixLength: 1 },
      },
    },
  ];

  const filterClauses = [{ equals: { path: 'enabled', value: true } }];
  if (domain) filterClauses.push({ equals: { path: 'domain', value: domain } });
  if (venue) filterClauses.push({ equals: { path: 'venue', value: venue } });

  const docs = await collection.aggregate([
    {
      $search: {
        index: env.RAG_SEARCH_INDEX_NAME,
        compound: {
          must: mustClauses,
          filter: filterClauses,
        },
      },
    },
    { $limit: limit },
    {
      $project: {
        _id: 1,
        title: 1,
        content: 1,
        domain: 1,
        category: 1,
        keywordsText: 1,
        tagsText: 1,
        venue: 1,
        sourceCollection: 1,
        sourceId: 1,
        score: { $meta: 'searchScore' },
      },
    },
  ]).toArray();

  return docs.map((doc) => ({ ...doc, retrievalSource: 'text' }));
}

async function runAtlasVectorSearch(collection, { query, domain, venue, limit, numCandidates }) {
  const queryVector = await embedText(query);
  const docs = await collection.aggregate([
    {
      $vectorSearch: {
        index: env.RAG_VECTOR_INDEX_NAME,
        path: 'embedding',
        queryVector,
        numCandidates,
        limit,
        filter: buildVectorFilter({ domain, venue }),
      },
    },
    {
      $project: {
        _id: 1,
        title: 1,
        content: 1,
        domain: 1,
        category: 1,
        keywordsText: 1,
        tagsText: 1,
        venue: 1,
        sourceCollection: 1,
        sourceId: 1,
        score: { $meta: 'vectorSearchScore' },
      },
    },
  ]).toArray();

  return docs.map((doc) => ({ ...doc, retrievalSource: 'vector' }));
}

async function runFallbackSearch(collection, { query, domain, venue, limit }) {
  const filter = { enabled: { $ne: false } };
  if (domain) filter.domain = domain;
  if (venue) filter.venue = venue;

  const docs = await collection.find(filter, {
    projection: {
      title: 1,
      content: 1,
      domain: 1,
      category: 1,
      keywordsText: 1,
      tagsText: 1,
      venue: 1,
      sourceCollection: 1,
      sourceId: 1,
    },
  }).limit(300).toArray();

  return docs
    .map((doc) => ({ ...doc, score: scoreLexicalMatch(doc, query), retrievalSource: 'fallback' }))
    .filter((doc) => doc.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function mergeHybridResults(textResults, vectorResults, limit) {
  const merged = new Map();

  for (const [index, item] of textResults.entries()) {
    const id = String(item._id);
    const existing = merged.get(id) || { ...item, hybridScore: 0, matchedBy: new Set() };
    existing.hybridScore += item.score + (textResults.length - index);
    existing.matchedBy.add('text');
    merged.set(id, existing);
  }

  for (const [index, item] of vectorResults.entries()) {
    const id = String(item._id);
    const existing = merged.get(id) || { ...item, hybridScore: 0, matchedBy: new Set() };
    existing.hybridScore += (item.score || 0) * 10 + (vectorResults.length - index);
    existing.matchedBy.add('vector');
    merged.set(id, existing);
  }

  return [...merged.values()]
    .sort((a, b) => b.hybridScore - a.hybridScore)
    .slice(0, limit)
    .map((item) => ({
      ...item,
      matchedBy: [...item.matchedBy],
      id: item._id,
    }));
}

export function buildKnowledgePrompt(results) {
  if (!Array.isArray(results) || results.length === 0) {
    return '无';
  }

  return results.map((item, index) => {
    const head = [
      `#${index + 1}`,
      `domain=${item.domain || 'general_policy'}`,
      item.category ? `category=${item.category}` : '',
      item.sourceCollection ? `source=${item.sourceCollection}` : '',
      item.venue ? `venue=${item.venue}` : '',
      item.matchedBy?.length ? `matchedBy=${item.matchedBy.join('+')}` : '',
    ].filter(Boolean).join(' | ');

    return `${head}\n标题：${item.title || '无标题'}\n内容：${item.content || ''}`;
  }).join('\n\n---\n\n');
}

export async function retrieveKnowledgeContext({ query, coreIntent = '', venue = '', limit = env.RAG_FINAL_RESULT_LIMIT }) {
  const db = mongoose.connection.db;
  const collection = db.collection('knowledge_units');
  const explicitDomain = INTENT_DOMAIN_MAP[coreIntent];
  const domainHint = explicitDomain && coreIntent !== 'OTHER'
    ? explicitDomain
    : inferDomainFromText(query);

  const runRetrieval = async (domain) => {
    let textResults = [];
    let vectorResults = [];
    let mode = 'fallback';

    try {
      textResults = await runAtlasTextSearch(collection, {
        query,
        domain,
        venue,
        limit: env.RAG_TEXT_RESULT_LIMIT,
      });
      mode = 'text';
    } catch {}

    try {
      vectorResults = await runAtlasVectorSearch(collection, {
        query,
        domain,
        venue,
        limit: env.RAG_VECTOR_RESULT_LIMIT,
        numCandidates: env.RAG_VECTOR_CANDIDATES,
      });
      mode = textResults.length > 0 ? 'hybrid' : 'vector';
    } catch {}

    if (textResults.length === 0 && vectorResults.length === 0) {
      textResults = await runFallbackSearch(collection, {
        query,
        domain,
        venue,
        limit: env.RAG_TEXT_RESULT_LIMIT,
      });
    }

    return { textResults, vectorResults, mode };
  };

  let { textResults, vectorResults, mode: retrievalMode } = await runRetrieval(domainHint);

  // Domain inference is heuristic - if the filtered search misses, retry without
  // the domain filter so user-authored scripts (e.g. 补偿金) saved under a different
  // domain can still surface.
  if (domainHint && textResults.length === 0 && vectorResults.length === 0) {
    const relaxed = await runRetrieval(null);
    textResults = relaxed.textResults;
    vectorResults = relaxed.vectorResults;
    if (textResults.length > 0 || vectorResults.length > 0) {
      retrievalMode = `${relaxed.mode}+nodomain`;
    }
  }

  const results = mergeHybridResults(textResults, vectorResults, limit);
  return {
    domain: domainHint,
    retrievalMode,
    results,
    prompt: buildKnowledgePrompt(results),
  };
}

function makeBaseUnit({ sourceCollection, sourceId, domain, category, title, keywords, content, tags = [], venue = null, order = 0 }) {
  const keywordList = normalizeKeywordList(keywords);
  const tagList = normalizeKeywordList(tags);
  const safeTitle = normalizeString(title) || keywordList[0] || category || sourceCollection;
  const safeContent = normalizeString(content);
  if (!safeContent) return null;

  return {
    _id: `${sourceCollection}:${sourceId}:${order}`,
    sourceCollection,
    sourceId,
    domain,
    category: normalizeString(category),
    title: safeTitle,
    keywords: keywordList,
    keywordsText: keywordList.join(' '),
    content: safeContent,
    tags: tagList,
    tagsText: tagList.join(' '),
    venue: normalizeString(venue) || null,
    enabled: true,
    retrievalText: compactTextParts([safeTitle, keywordList.join(' '), safeContent]),
    updatedAt: new Date().toISOString(),
  };
}

const RAG_SOURCE_COLLECTIONS = new Set([
  'knowledge_base',
  'scripts',
  'templates',
  'training_data',
  'venue_rules',
  'global_settings',
]);

export function isRagSourceCollection(collection) {
  return RAG_SOURCE_COLLECTIONS.has(collection);
}

export function buildKnowledgeUnitsForDocument(sourceCollection, doc) {
  if (!doc?._id || !isRagSourceCollection(sourceCollection)) return [];

  if (sourceCollection === 'knowledge_base') {
    const unit = makeBaseUnit({
      sourceCollection,
      sourceId: doc._id,
      domain: inferDomainFromCategory(doc.category, doc.keywords, doc.content),
      category: doc.category,
      title: doc.keywords,
      keywords: doc.keywords,
      content: doc.content,
      tags: doc.tags,
    });
    return unit ? [unit] : [];
  }

  if (sourceCollection === 'scripts') {
    const unit = makeBaseUnit({
      sourceCollection,
      sourceId: doc._id,
      domain: inferDomainFromCategory(doc.category, doc.keywords, doc.content, 'internal_template'),
      category: doc.category,
      title: doc.keywords,
      keywords: doc.keywords,
      content: doc.content,
    });
    return unit ? [unit] : [];
  }

  if (sourceCollection === 'templates') {
    const content = compactTextParts([doc.front, doc.inner, doc.mail]);
    const unit = makeBaseUnit({
      sourceCollection,
      sourceId: doc._id,
      domain: 'internal_template',
      category: doc.type || 'template',
      title: doc.type,
      keywords: [doc.type, ...(doc.requiredVars || [])],
      content,
      tags: doc.requiredVars,
    });
    return unit ? [unit] : [];
  }

  if (sourceCollection === 'training_data') {
    if (doc.type && doc.type !== 'good') return [];
    const content = compactTextParts([`Q: ${doc.question || ''}`, `A: ${doc.answer || ''}`]);
    const unit = makeBaseUnit({
      sourceCollection,
      sourceId: doc._id,
      domain: inferDomainFromText(content),
      category: doc.type || 'training',
      title: doc.question,
      keywords: doc.question,
      content,
      tags: [doc.type],
    });
    return unit ? [unit] : [];
  }

  if (sourceCollection === 'venue_rules') {
    return splitLongText(doc.name || 'venue_rules', doc.rules || '')
      .map((section, index) => makeBaseUnit({
        sourceCollection,
        sourceId: doc._id,
        domain: 'venue_issue',
        category: 'venue_rules',
        title: section.title,
        keywords: [doc.name, section.title],
        content: section.content,
        venue: doc.name,
        order: index,
      }))
      .filter(Boolean);
  }

  if (sourceCollection === 'global_settings' && doc._id === 'ai_prompts') {
    const settingsSections = [
      ['business_rules', doc.business_rules, 'general_policy'],
      ['chat_knowledge', doc.chat_knowledge, 'general_policy'],
      ['ann_knowledge', doc.ann_knowledge, 'general_policy'],
    ];
    return settingsSections.flatMap(([name, text, domain]) => (
      splitLongText(name, text || '', 1200)
        .map((section, index) => makeBaseUnit({
          sourceCollection,
          sourceId: `ai_prompts:${name}`,
          domain,
          category: 'global_settings',
          title: section.title,
          keywords: [name, section.title],
          content: section.content,
          order: index,
        }))
        .filter(Boolean)
    ));
  }

  return [];
}

export async function syncKnowledgeUnitsForDocument(sourceCollection, doc) {
  if (!doc?._id || !isRagSourceCollection(sourceCollection)) return { skipped: true };

  const db = mongoose.connection.db;
  const collection = db.collection('knowledge_units');
  const sourceId = String(doc._id);
  await collection.deleteMany({ sourceCollection, sourceId });

  if (sourceCollection === 'global_settings') {
    await collection.deleteMany({ sourceCollection, sourceId: /^ai_prompts:/ });
  }

  let units = buildKnowledgeUnitsForDocument(sourceCollection, { ...doc, _id: sourceId });
  if (units.length === 0) return { deleted: true, inserted: 0 };

  units = await createEmbeddingsForUnits(units);
  await collection.bulkWrite(units.map((unit) => ({
    updateOne: {
      filter: { _id: unit._id },
      update: { $set: unit },
      upsert: true,
    },
  })), { ordered: false });

  return { deleted: true, inserted: units.length };
}

export async function deleteKnowledgeUnitsForDocument(sourceCollection, sourceId) {
  if (!sourceId || !isRagSourceCollection(sourceCollection)) return { skipped: true };
  const db = mongoose.connection.db;
  const result = await db.collection('knowledge_units').deleteMany({
    sourceCollection,
    sourceId: String(sourceId),
  });
  return { deletedCount: result.deletedCount };
}

export function buildKnowledgeUnitsFromSnapshot(snapshot) {
  const units = [];

  for (const item of snapshot.knowledge_base || []) {
    units.push(...buildKnowledgeUnitsForDocument('knowledge_base', item));
  }

  for (const item of snapshot.scripts || []) {
    units.push(...buildKnowledgeUnitsForDocument('scripts', item));
  }

  for (const item of snapshot.templates || []) {
    units.push(...buildKnowledgeUnitsForDocument('templates', item));
  }

  for (const item of snapshot.training_data || []) {
    units.push(...buildKnowledgeUnitsForDocument('training_data', item));
  }

  for (const item of snapshot.venue_rules || []) {
    units.push(...buildKnowledgeUnitsForDocument('venue_rules', item));
  }

  const aiPrompts = (snapshot.global_settings || []).find((item) => item._id === 'ai_prompts') || {};
  units.push(...buildKnowledgeUnitsForDocument('global_settings', aiPrompts));

  return units;
}

export async function createEmbeddingsForUnits(units) {
  const withEmbeddings = [];

  for (const unit of units) {
    const embedding = await embedText(unit.retrievalText);
    withEmbeddings.push({ ...unit, embedding });
  }

  return withEmbeddings;
}
