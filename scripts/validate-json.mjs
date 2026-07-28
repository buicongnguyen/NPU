import { readFile } from 'node:fs/promises';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const manifests = [
  ['data/analog-cim-architecture.json', 'schemas/analog-cim-architecture.schema.json'],
  ['data/analog-cim-evidence.json', 'schemas/analog-cim-evidence.schema.json'],
  ['data/analog-cim-mcq.json', 'schemas/analog-cim-mcq.schema.json']
];

const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
let failed = false;
const documents = new Map();
const validators = new Map();

for (const [dataPath, schemaPath] of manifests) {
  const data = JSON.parse(await readFile(dataPath, 'utf8'));
  const schema = JSON.parse(await readFile(schemaPath, 'utf8'));
  const validate = ajv.compile(schema);
  documents.set(dataPath, data);
  validators.set(dataPath, validate);
  if (!validate(data)) {
    failed = true;
    console.error(`${dataPath} does not match ${schemaPath}`);
    for (const error of validate.errors ?? []) {
      console.error(`  ${error.instancePath || '/'} ${error.message}`);
    }
  }

  const collections = Object.values(data).filter(Array.isArray);
  for (const collection of collections) {
    const ids = collection.flatMap((entry) =>
      entry && typeof entry === 'object' && typeof entry.id === 'string' ? [entry.id] : []
    );
    if (new Set(ids).size !== ids.length) {
      failed = true;
      console.error(`${dataPath} contains duplicate IDs`);
    }
  }
}

const expectSchemaRejection = (dataPath, description, mutate) => {
  const candidate = structuredClone(documents.get(dataPath));
  mutate(candidate);
  if (validators.get(dataPath)(candidate)) {
    failed = true;
    console.error(`${dataPath} schema accepted invalid ${description}`);
  }
};

expectSchemaRejection(manifests[0][0], 'non-HTTPS source URL', (data) => {
  data.sources[0].url = 'javascript:alert(1)';
});
expectSchemaRejection(manifests[1][0], 'evidence level', (data) => {
  data.studies[0].evidenceLevel = 'unverified-typo';
});
expectSchemaRejection(manifests[1][0], 'non-HTTPS study URL', (data) => {
  data.studies[0].sourceUrl = 'javascript:alert(1)';
});
expectSchemaRejection(manifests[1][0], 'non-HTTPS claim URL', (data) => {
  data.claimTests[0].sources[0].url = 'javascript:alert(1)';
});
expectSchemaRejection(manifests[2][0], 'seventh answer choice', (data) => {
  data.questions[0].choices = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
});
expectSchemaRejection(manifests[2][0], 'non-HTTPS source URL', (data) => {
  data.sources[Object.keys(data.sources)[0]].url = 'javascript:alert(1)';
});

const architecture = documents.get(manifests[0][0]);
const architectureSources = new Set(architecture.sources.map(({ id }) => id));
for (const stage of architecture.signalPath) {
  for (const sourceId of stage.sourceIds) {
    if (!architectureSources.has(sourceId)) {
      failed = true;
      console.error(`Architecture stage ${stage.id} references unknown source ${sourceId}`);
    }
  }
}
for (const metric of architecture.mythicSnapshot) {
  if (!architectureSources.has(metric.sourceId)) {
    failed = true;
    console.error(`Architecture metric ${metric.label} references unknown source ${metric.sourceId}`);
  }
}

const mcq = documents.get(manifests[2][0]);
const mcqSources = new Set(Object.keys(mcq.sources));
if (mcq.meta.questionCount !== mcq.questions.length) {
  failed = true;
  console.error(
    `MCQ metadata declares ${mcq.meta.questionCount} questions but contains ${mcq.questions.length}`
  );
}
for (const question of mcq.questions) {
  if (question.answer >= question.choices.length) {
    failed = true;
    console.error(`Question ${question.id} answer index is outside its choices`);
  }
  for (const sourceId of question.sourceIds) {
    if (!mcqSources.has(sourceId)) {
      failed = true;
      console.error(`Question ${question.id} references unknown source ${sourceId}`);
    }
  }
}

if (failed) process.exitCode = 1;
else console.log(`Validated ${manifests.length} JSON documents and their cross-references`);
