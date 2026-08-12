import { assertEquals } from "jsr:@std/assert@1.0.13/equals";
import { evaluateSignupEmail, isSuspiciousSignupEmail } from "./emailSignupPolicy.ts";

Deno.test("evaluateSignupEmail allows normal addresses", () => {
  const result = evaluateSignupEmail("user@example.com");
  assertEquals(result.allowed, true);
  if (result.allowed) {
    assertEquals(result.normalizedEmail, "user@example.com");
  }
});

Deno.test("evaluateSignupEmail blocks pornhub spam pattern", () => {
  const result = evaluateSignupEmail("pornhub38969@hotmail.com");
  assertEquals(result.allowed, false);
  if (!result.allowed) {
    assertEquals(result.code, "blocked_email");
  }
});

Deno.test("evaluateSignupEmail blocks porhub typo variant", () => {
  const result = evaluateSignupEmail("porhub94274@hotmail.com");
  assertEquals(result.allowed, false);
  if (!result.allowed) {
    assertEquals(result.code, "blocked_email");
  }
});

Deno.test("evaluateSignupEmail blocks disposable domains", () => {
  const result = evaluateSignupEmail("test@mailinator.com");
  assertEquals(result.allowed, false);
  if (!result.allowed) {
    assertEquals(result.code, "disposable_domain");
  }
});

Deno.test("isSuspiciousSignupEmail flags spam addresses", () => {
  assertEquals(isSuspiciousSignupEmail("pornhub11765@hotmail.com"), true);
  assertEquals(isSuspiciousSignupEmail("real.user@gmail.com"), false);
});
