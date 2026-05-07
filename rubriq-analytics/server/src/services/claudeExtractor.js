const https = require('https');

function glmRequest(payload) {
  if (!process.env.GLM_API_KEY) {
    const err = new Error('GLM_API_KEY is not configured. Add it to your environment variables.');
    err.status = 503;
    throw err;
  }
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const options = {
      hostname: 'open.bigmodel.cn',
      path: '/api/paas/v4/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.GLM_API_KEY}`,
        'Content-Length': Buffer.byteLength(body),
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) return reject(new Error(parsed.error.message || 'GLM API error'));
          resolve(parsed);
        } catch (e) { reject(new Error('Invalid JSON from GLM API')); }
      });
    });
    req.on('error', reject);
    req.setTimeout(120000, () => { req.destroy(); reject(new Error('GLM API timeout')); });
    req.write(body);
    req.end();
  });
}

const EXTRACTION_PROMPT = `You are an expert academic data extractor. Analyze the provided course syllabus document and extract all structured academic data.

Return ONLY a valid JSON object with this exact structure (use null for missing fields, never omit keys):

{
  "university": { "name": null, "code": null },
  "college": { "name": null, "code": null },
  "department": { "name": null, "code": null, "hodName": null },
  "program": { "name": null, "code": null, "level": null, "duration": null },
  "course": { "name": null, "code": null, "credits": null, "semester": null, "description": null },
  "courseOutcomes": [
    { "code": "CO1", "description": null, "bloomLevel": null, "bloomVerbs": [] }
  ],
  "programOutcomes": [
    { "code": "PO1", "description": null }
  ],
  "programSpecificOutcomes": [
    { "code": "PSO1", "description": null }
  ],
  "coPOMapping": [
    { "co": "CO1", "po": "PO1", "strength": 3 }
  ],
  "coPSOMapping": [
    { "co": "CO1", "pso": "PSO1", "strength": 2 }
  ],
  "rubricCriteria": [
    {
      "title": null,
      "maxMarks": null,
      "bloomLevel": null,
      "mappedCO": null,
      "orderIndex": 0,
      "levels": [
        { "label": "Excellent", "minMarks": null, "maxMarks": null, "descriptor": null },
        { "label": "Good", "minMarks": null, "maxMarks": null, "descriptor": null },
        { "label": "Satisfactory", "minMarks": null, "maxMarks": null, "descriptor": null },
        { "label": "Needs Improvement", "minMarks": null, "maxMarks": null, "descriptor": null }
      ]
    }
  ],
  "assessmentConfig": {
    "internalWeightage": 30,
    "externalWeightage": 70,
    "attainmentThreshold": 60,
    "totalMarks": 30
  },
  "confidence": {
    "university": 0.9,
    "college": 0.9,
    "department": 0.9,
    "program": 0.9,
    "course": 0.9,
    "courseOutcomes": 0.9,
    "programOutcomes": 0.9,
    "coPOMapping": 0.9,
    "rubricCriteria": 0.9
  }
}

Rules:
- bloomLevel must be one of: Remember, Understand, Apply, Analyze, Evaluate, Create
- strength values must be 1 (low), 2 (medium), or 3 (high)
- confidence is 0.0-1.0 per section based on how clearly it appears in the document
- If rubric criteria are not in the document, return empty array []
- If CO-PO mapping table exists, extract all mappings
- Extract ALL course outcomes found, typically CO1-CO6 or more
- Return ONLY the JSON, no explanation text`;

async function extractFromText(text) {
  const response = await glmRequest({
    model: 'glm-4-flash',
    messages: [{ role: 'user', content: `${EXTRACTION_PROMPT}\n\nDocument content:\n\n${text.slice(0, 15000)}` }],
    max_tokens: 4096,
  });
  const raw = response.choices[0].message.content.trim();
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('GLM did not return valid JSON');
  return JSON.parse(jsonMatch[0]);
}

async function extractFromImage(base64, mediaType) {
  const response = await glmRequest({
    model: 'glm-4v-flash',
    messages: [{
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: `data:${mediaType};base64,${base64}` } },
        { type: 'text', text: EXTRACTION_PROMPT },
      ],
    }],
    max_tokens: 4096,
  });
  const raw = response.choices[0].message.content.trim();
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('GLM did not return valid JSON');
  return JSON.parse(jsonMatch[0]);
}

async function extractFromDocument(parsed) {
  if (parsed.type === 'image') return extractFromImage(parsed.base64, parsed.mediaType);
  return extractFromText(parsed.text);
}

module.exports = { extractFromDocument };
