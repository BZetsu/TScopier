import { assertEquals, assertRejects } from "jsr:@std/assert"
import {
  normalizeBsaSearchResponse,
  platformToBsaCode,
  searchBrokerCompanies,
} from "./fxsocketBsaClient.ts"

Deno.test("platformToBsaCode maps MT4/MT5 to BSA codes", () => {
  assertEquals(platformToBsaCode("MT4"), "mt4")
  assertEquals(platformToBsaCode("mt4"), "mt4")
  assertEquals(platformToBsaCode("MT5"), "mt5")
  assertEquals(platformToBsaCode(""), "mt5")
})

Deno.test("normalizeBsaSearchResponse maps company and server fields", () => {
  const companies = normalizeBsaSearchResponse({
    result: [
      {
        company: "IC Markets",
        results: [
          {
            name: "ICMarketsSC-Demo",
            logo_url: "https://example.com/logo.png",
            site: "https://icmarkets.com",
            access: ["demo"],
          },
        ],
      },
    ],
  })

  assertEquals(companies.length, 1)
  assertEquals(companies[0].companyName, "IC Markets")
  assertEquals(companies[0].results?.[0]?.name, "ICMarketsSC-Demo")
  assertEquals(companies[0].results?.[0]?.logoUrl, "https://example.com/logo.png")
  assertEquals(companies[0].results?.[0]?.site, "https://icmarkets.com")
  assertEquals(companies[0].results?.[0]?.access, ["demo"])
})

Deno.test("searchBrokerCompanies rejects short company fragments", async () => {
  const env = { get: () => "test-key" }
  await assertRejects(
    () => searchBrokerCompanies(env, { company: "abc" }),
    Error,
    "company must be at least 4 characters",
  )
})
