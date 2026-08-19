// All fixture content invented.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  tidyTitle,
  tidyAuthor,
  normalizeIsbn,
  slugify,
  bookFileName,
  coverFileName,
  buildBookRecord,
  RECORD_KIND,
} from "../src/book.js";

describe("tidyTitle", () => {
  test("keeps the subtitle, which is part of the title", () => {
    assert.equal(tidyTitle("Anchors and Sails: A Field Guide"), "Anchors and Sails: A Field Guide");
  });

  test("drops the format clause a shop appends", () => {
    assert.equal(tidyTitle("Anchors and Sails – Paperback, January 3 2021"), "Anchors and Sails");
    assert.equal(tidyTitle("The Quiet Hour — Kindle Edition"), "The Quiet Hour");
    assert.equal(tidyTitle("Weather Systems (Hardcover)"), "Weather Systems");
  });

  test("drops a trailing site name", () => {
    assert.equal(tidyTitle("The Quiet Hour | Bookshop.org"), "The Quiet Hour");
    assert.equal(tidyTitle("A Borrowed Compass - Goodreads"), "A Borrowed Compass");
  });

  test("leaves a dash that belongs to the title alone", () => {
    assert.equal(tidyTitle("Anchors and Sails - Second Edition"), "Anchors and Sails - Second Edition");
  });

  test("collapses whitespace", () => {
    assert.equal(tidyTitle("  The   Quiet\nHour "), "The Quiet Hour");
  });
});

describe("tidyAuthor", () => {
  test("strips the byline furniture", () => {
    assert.equal(tidyAuthor("by R. Vantree"), "R. Vantree");
    assert.equal(tidyAuthor("R. Vantree (Author)"), "R. Vantree");
    assert.equal(tidyAuthor("L. Strand (Author, Editor)"), "L. Strand");
  });

  test("keeps only the first of several authors", () => {
    assert.equal(tidyAuthor("R. Vantree and L. Strand"), "R. Vantree");
    assert.equal(tidyAuthor("R. Vantree; L. Strand"), "R. Vantree");
    assert.equal(tidyAuthor("R. Vantree & L. Strand"), "R. Vantree");
  });

  test("does not split a surname-first name on its comma", () => {
    assert.equal(tidyAuthor("Vantree, R."), "Vantree, R.");
  });

  test("is empty for nothing", () => {
    assert.equal(tidyAuthor(""), "");
    assert.equal(tidyAuthor(undefined), "");
  });
});

describe("normalizeIsbn", () => {
  test("accepts both lengths, hyphenated or not", () => {
    assert.equal(normalizeIsbn("978-1-4028-9462-6"), "9781402894626");
    assert.equal(normalizeIsbn("0306406152"), "0306406152");
    assert.equal(normalizeIsbn("ISBN-13: 978 1 4028 9462 6"), "9781402894626");
  });

  test("keeps a trailing X, which is a real check digit", () => {
    assert.equal(normalizeIsbn("039480001X"), "039480001X");
  });

  test("refuses anything that isn't one, rather than passing it through", () => {
    assert.equal(normalizeIsbn("12345"), "");
    assert.equal(normalizeIsbn("not-an-isbn"), "");
    assert.equal(normalizeIsbn("97814028946267"), "");
    assert.equal(normalizeIsbn(""), "");
  });
});

describe("filenames", () => {
  test("slugifies a title, accents and punctuation included", () => {
    assert.equal(slugify("Anchors & Sails: A Field Guide"), "anchors-sails-a-field-guide");
    assert.equal(slugify("Café Réverie"), "cafe-reverie");
    assert.equal(slugify("???"), "book");
  });

  test("names the record and the cover off the same slug", () => {
    const fields = { title: "The Quiet Hour" };
    assert.equal(bookFileName(fields), "the-quiet-hour.book.json");
    assert.equal(coverFileName(fields, "https://example.invalid/img/cover.png"), "the-quiet-hour.png");
  });

  test("normalises jpeg and falls back to jpg", () => {
    const fields = { title: "The Quiet Hour" };
    assert.equal(coverFileName(fields, "https://example.invalid/c.jpeg"), "the-quiet-hour.jpg");
    assert.equal(coverFileName(fields, "https://example.invalid/image?id=99"), "the-quiet-hour.jpg");
    assert.equal(coverFileName(fields, ""), "the-quiet-hour.jpg");
  });
});

describe("buildBookRecord", () => {
  test("writes a tidy record and omits what it doesn't have", () => {
    const record = buildBookRecord(
      { title: "The Quiet Hour — Paperback", author: "by M. Okonjo (Author)", isbn: "978-1-4028-9462-6" },
      { coverFile: "the-quiet-hour.jpg", sourceUrl: "https://example.invalid/book", clippedAt: "2026-08-19T12:00:00.000Z" }
    );
    assert.deepEqual(record, {
      kind: RECORD_KIND,
      version: 1,
      title: "The Quiet Hour",
      author: "M. Okonjo",
      isbn: "9781402894626",
      cover_file: "the-quiet-hour.jpg",
      source_url: "https://example.invalid/book",
      clipped_at: "2026-08-19T12:00:00.000Z",
    });
  });

  test("leaves out an author and isbn it couldn't establish", () => {
    const record = buildBookRecord({ title: "Anchors and Sails", author: "", isbn: "nope" }, { clippedAt: "x" });
    assert.equal("author" in record, false);
    assert.equal("isbn" in record, false);
    assert.equal("cover_file" in record, false);
  });

  test("refuses a record with no title", () => {
    assert.throws(() => buildBookRecord({ title: "   " }), /needs a title/);
  });

  test("never carries anything about a person the book is for", () => {
    const record = buildBookRecord({ title: "Anchors and Sails" }, { clippedAt: "x" });
    const keys = Object.keys(record).join(" ");
    assert.equal(/client|patient|borrow|loan/i.test(keys), false);
  });
});
