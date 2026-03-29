import { Resend } from "resend"

export const resend = new Resend(process.env.RESEND_API_KEY)

export async function sendReportEmail(
  to: string[],
  subject: string,
  html: string
): Promise<void> {
  await resend.emails.send({
    from: "TYDEi Reports <reports@tydei.com>",
    to,
    subject,
    html,
  })
}
