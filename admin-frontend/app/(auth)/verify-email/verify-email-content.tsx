"use client";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { resendVerificationEmail } from "./actions";
import { Loader2, MailCheck, MailWarning } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

const COOLDOWN_SECONDS = 60;

export default function VerifyEmailContent() {
  const searchParams = useSearchParams();
  const email = searchParams.get("email") ?? "";

  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0); // seconds remaining
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Start a countdown from COOLDOWN_SECONDS down to 0
  function startCooldown() {
    setCooldown(COOLDOWN_SECONDS);
    intervalRef.current = setInterval(() => {
      setCooldown((prev) => {
        if (prev <= 1) {
          clearInterval(intervalRef.current!);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }

  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  async function handleResend() {
    if (!email || cooldown > 0 || loading) return;

    setError(null);
    setLoading(true);

    const error = await resendVerificationEmail(email);

    setLoading(false);

    if (error) {
      setError(error ?? "Noget gik galt. Prøv igen.");
    } else {
      setSent(true);
      startCooldown();
    }
  }

  const isDisabled = loading || cooldown > 0 || !email;

  return (
    <div className="flex min-h-[calc(100dvh-6rem)] items-center justify-center p-4">
      <Card className="max-w-md w-full">
        <CardHeader className="items-center text-center">
          {sent ? (
            <MailCheck className="mb-2 h-10 w-10 text-muted-foreground" />
          ) : (
            <MailWarning className="mb-2 h-10 w-10 text-muted-foreground" />
          )}
          <CardTitle className="text-lg md:text-xl">
            {sent ? "E-mail sendt" : "Bekræft din e-mail"}
          </CardTitle>
          <CardDescription className="text-xs md:text-sm">
            {sent ? (
              <>
                Vi har sendt et nyt bekræftelseslink til{" "}
                <span className="font-medium text-foreground">{email}</span>.
                Tjek din indbakke og klik på linket for at aktivere din konto.
              </>
            ) : (
              <>
                Din konto er endnu ikke bekræftet. Tjek din indbakke for et
                bekræftelseslink
                {email && (
                  <>
                    {" "}
                    sendt til{" "}
                    <span className="font-medium text-foreground">{email}</span>
                  </>
                )}
                .
              </>
            )}
          </CardDescription>
        </CardHeader>

        {email && (
          <CardContent className="grid gap-4 text-center">
            {error && <p className="text-sm text-destructive">{error}</p>}

            <Button
              className="w-full"
              disabled={isDisabled}
              onClick={handleResend}
            >
              {loading ? (
                <Loader2 size={16} className="animate-spin" />
              ) : cooldown > 0 ? (
                `Send igen om ${cooldown}s`
              ) : (
                "Send bekræftelsesmail igen"
              )}
            </Button>

            <Link
              href="/login"
              className="text-sm underline underline-offset-4"
            >
              Tilbage til login
            </Link>
          </CardContent>
        )}

        {!email && (
          <CardContent className="text-center">
            <Link
              href="/login"
              className="text-sm underline underline-offset-4"
            >
              Tilbage til login
            </Link>
          </CardContent>
        )}
      </Card>
    </div>
  );
}
