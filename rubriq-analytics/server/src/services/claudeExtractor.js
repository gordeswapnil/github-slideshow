const Anthropic = require('@anthropic-ai/sdk');

function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) {
    const err = new Error('ANTHROPIC_API_KEY is not configured in environment variables.');
    err.status = 503;
    throw err;
  }
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

const EXTRACTION_PROMPT = `You are an expert academic data extractor. Analyze the provided course syllabus or assignment document and extract all structured academic data.

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

FIELD RULES:
- bloomLevel: one of Remember, Understand, Apply, Analyze, Evaluate, Create
- duration: integer years only ("3 Years" → 3, "2 years" → 2)
- credits, semester, totalMarks, maxMarks, minMarks: always integers
- strength: integer 1 (low), 2 (medium), or 3 (high)
- confidence: 0.0–1.0 per section

RUBRIC TABLE EXTRACTION (critical):
The document may contain a rubric/evaluation table with criteria as rows and performance levels as columns (Excellent, Good, Satisfactory, Needs Improvement or similar). Column headers often show an overall score range like "21-25" or ">80%".
For EACH criterion row:
1. Extract the criterion title and its weight/max marks (e.g. "Content (Weight: 6 Marks)" → title="Content", maxMarks=6)
2. Compute per-criterion mark ranges proportionally from the criterion's maxMarks:
   - Excellent: round(0.81 × maxMarks) to maxMarks
   - Good: round(0.61 × maxMarks) to round(0.80 × maxMarks)
   - Satisfactory: round(0.40 × maxMarks) to round(0.60 × maxMarks)
   - Needs Improvement: 0 to round(0.39 × maxMarks)
3. Extract the descriptor text from each cell for that criterion and level
4. Set assessmentConfig.totalMarks = sum of all criteria maxMarks

CO-PO MAPPING TABLE:
- Rows = COs, Columns = POs. Cell value 3=High, 2=Medium, 1=Low, "-" or blank = skip (do not include in coPOMapping array)
- Only include entries where a numeric strength (1/2/3) exists

- If no rubric table found: rubricCriteria = []
- Extract ALL course outcomes (CO1–CO6 or more)
- Return ONLY the JSON object, no explanation`;

async function extractFromText(text) {
  const client = getClient();
  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 8192,
    messages: [{ role: 'user', content: `${EXTRACTION_PROMPT}\n\nDocument content:\n\n${text.slice(0, 12000)}` }],
  });
  const raw = message.content[0].text.trim();
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('AI did not return valid JSON');
  return JSON.parse(jsonMatch[0]);
}

async function extractFromImage(base64, mediaType) {
  const client = getClient();
  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 8192,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
        { type: 'text', text: EXTRACTION_PROMPT },
      ],
    }],
  });
  const raw = message.content[0].text.trim();
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('AI did not return valid JSON');
  return JSON.parse(jsonMatch[0]);
}

async function extractFromDocument(parsed) {
  if (parsed.type === 'image') return extractFromImage(parsed.base64, parsed.mediaType);
  return extractFromText(parsed.text);
}

module.exports = { extractFromDocument };
