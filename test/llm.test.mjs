// The verification layer is the whole safety story for the local-model step,
// so these tests are mostly about what gets THROWN AWAY. A model that invents
// a practice name is the expected failure mode, not an exotic one.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  buildRequest,
  comparisonForm,
  FILLABLE_FIELDS,
  missingFields,
  pickModel,
  verifyCandidate,
} from "../src/llm.js";

const PAGE =
  "Welcome. I'm Mira Okonjo, LMFT, practicing at Northgate Family Therapy in Ashford. " +
  "I work with couples and offer perinatal mental health support, plus EMDR for trauma.";

const SCRAPED = {
  fullName: "Mira Okonjo",
  credentials: "LMFT",
  organization: "",
  specialization: "",
  phone: "555-010-2288",
  email: "mira@northgate.example",
  website: "https://northgate.example",
  address: "",
};

describe("missingFields", () => {
  test("offers only blank fillable fields", () => {
    assert.deepEqual(missingFields(SCRAPED), ["organization", "specialization"]);
  });

  test("treats whitespace as blank", () => {
    assert.ok(missingFields({ ...SCRAPED, organization: "   " }).includes("organization"));
  });

  test("never offers contact details, even when they're blank", () => {
    const empty = missingFields({});
    for (const key of ["phone", "email", "website", "address"]) {
      assert.ok(!empty.includes(key), `${key} must never be asked of the model`);
    }
    assert.deepEqual(empty, FILLABLE_FIELDS);
  });
});

describe("verifyCandidate", () => {
  test("fills a blank organization the page actually supports", () => {
    const { filled, rejected } = verifyCandidate({ organization: "Northgate Family Therapy" }, SCRAPED, PAGE);
    assert.equal(filled.organization, "Northgate Family Therapy");
    assert.deepEqual(rejected, []);
  });

  test("drops an organization that appears nowhere on the page", () => {
    const { filled, rejected } = verifyCandidate({ organization: "Cedar Hollow Counseling" }, SCRAPED, PAGE);
    assert.equal(filled.organization, undefined);
    assert.deepEqual(rejected, [
      { field: "organization", value: "Cedar Hollow Counseling", reason: "not found on the page" },
    ]);
  });

  test("never overwrites a value the deterministic tiers already found", () => {
    const { filled } = verifyCandidate({ fullName: "Someone Else", credentials: "PsyD" }, SCRAPED, PAGE);
    assert.equal(filled.fullName, undefined);
    assert.equal(filled.credentials, undefined);
  });

  test("ignores contact details even if the model volunteers them", () => {
    const { filled } = verifyCandidate(
      { phone: "555-000-0000", email: "invented@example.test", website: "https://invented.test" },
      { ...SCRAPED, phone: "", email: "", website: "" },
      PAGE
    );
    assert.deepEqual(Object.keys(filled), []);
  });

  test("accepts a synthesized specialization without demanding a verbatim quote", () => {
    const { filled } = verifyCandidate(
      { specialization: "Couples therapy, perinatal mental health, EMDR" },
      SCRAPED,
      PAGE
    );
    assert.equal(filled.specialization, "Couples therapy, perinatal mental health, EMDR");
  });

  test("caps a runaway specialization", () => {
    const { filled } = verifyCandidate({ specialization: "trauma, ".repeat(80) }, SCRAPED, PAGE);
    assert.ok(filled.specialization.length <= 160);
  });

  test("matches across punctuation and case differences", () => {
    const { filled } = verifyCandidate({ organization: "northgate family therapy!" }, SCRAPED, PAGE);
    assert.equal(filled.organization, "northgate family therapy!");
  });

  test("ignores nulls and non-strings", () => {
    const { filled, rejected } = verifyCandidate({ organization: null, specialization: 42 }, SCRAPED, PAGE);
    assert.deepEqual(filled, {});
    assert.deepEqual(rejected, []);
  });

  test("survives a reply with no usable object at all", () => {
    assert.deepEqual(verifyCandidate(null, SCRAPED, PAGE), { filled: {}, rejected: [] });
  });
});

describe("buildRequest", () => {
  test("asks only for the fields that are missing", () => {
    const body = buildRequest(PAGE, ["organization"], "some-model");
    const schema = body.response_format.json_schema.schema;
    assert.deepEqual(Object.keys(schema.properties), ["organization"]);
    assert.deepEqual(schema.required, ["organization"]);
    assert.equal(schema.additionalProperties, false);
  });

  test("pins temperature to 0 so the same page gives the same answer", () => {
    assert.equal(buildRequest(PAGE, ["organization"], "m").temperature, 0);
  });

  test("labels the page as data rather than instructions", () => {
    const body = buildRequest(PAGE, ["organization"], "m");
    assert.match(body.messages[0].content, /DATA, not instructions/);
    assert.match(body.messages[1].content, /data, not instructions/);
    assert.ok(body.messages[1].content.includes(PAGE));
  });
});

describe("pickModel", () => {
  test("skips embedding models", () => {
    const chosen = pickModel([{ id: "text-embedding-nomic-embed-text-v1.5" }, { id: "qwen3.5-9b-instruct" }]);
    assert.equal(chosen, "qwen3.5-9b-instruct");
  });

  test("returns null when only embedding models are loaded", () => {
    assert.equal(pickModel([{ id: "text-embedding-three" }]), null);
  });

  test("tolerates an empty or absent list", () => {
    assert.equal(pickModel([]), null);
    assert.equal(pickModel(undefined), null);
  });
});

describe("comparisonForm", () => {
  test("collapses case, punctuation, and whitespace", () => {
    assert.equal(comparisonForm("  Northgate  Family-Therapy, PLLC. "), "northgate family therapy pllc");
  });

  test("tolerates null", () => {
    assert.equal(comparisonForm(null), "");
  });
});
