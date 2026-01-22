const fs = require('fs');
const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } = require('docx');

const doc = new Document({
  sections: [{
    properties: {},
    children: [
      // Title
      new Paragraph({
        text: "BUYERWATCH BY SELLING.COM",
        heading: HeadingLevel.TITLE,
        alignment: AlignmentType.CENTER,
        spacing: { after: 200 }
      }),
      new Paragraph({
        text: "The Irresistible Offer Document",
        heading: HeadingLevel.HEADING_2,
        alignment: AlignmentType.CENTER,
        spacing: { after: 400 }
      }),

      // PAGE 1
      new Paragraph({
        text: "PAGE 1: THE VALUE EQUATION OFFER",
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 400, after: 300 }
      }),

      new Paragraph({
        text: "The Dream Outcome (What You Get)",
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 300, after: 200 }
      }),

      new Paragraph({
        text: "Turn Every Champion Job Change Into Revenue",
        heading: HeadingLevel.HEADING_3,
        spacing: { after: 200 }
      }),

      new Paragraph({
        children: [
          new TextRun({ text: "When your champions move to new companies, you get:", break: 1 })
        ],
        spacing: { after: 100 }
      }),

      new Paragraph({
        children: [
          new TextRun({ text: "• ", bold: true }),
          new TextRun({ text: "6X higher conversion rates", bold: true }),
          new TextRun({ text: " (vs cold outreach)" })
        ],
        spacing: { after: 100 }
      }),

      new Paragraph({
        children: [
          new TextRun({ text: "• ", bold: true }),
          new TextRun({ text: "3X faster sales cycles", bold: true }),
          new TextRun({ text: " (existing relationship = trust)" })
        ],
        spacing: { after: 100 }
      }),

      new Paragraph({
        children: [
          new TextRun({ text: "• ", bold: true }),
          new TextRun({ text: "40-60% lower CAC", bold: true }),
          new TextRun({ text: " (no brand awareness needed)" })
        ],
        spacing: { after: 100 }
      }),

      new Paragraph({
        children: [
          new TextRun({ text: "• ", bold: true }),
          new TextRun({ text: "Automatic churn prevention", bold: true }),
          new TextRun({ text: " (know when decision-makers leave)" })
        ],
        spacing: { after: 300 }
      }),

      new Paragraph({
        text: "Perceived Likelihood of Achievement (Why It Works)",
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 300, after: 200 }
      }),

      new Paragraph({
        text: "Guaranteed Results, Not Just Data:",
        heading: HeadingLevel.HEADING_3,
        spacing: { after: 200 }
      }),

      new Paragraph({
        text: "✓ Real-time job change detection (within 48 hours)",
        spacing: { after: 100 }
      }),
      new Paragraph({
        text: "✓ Verified contact data (email + phone + title validation)",
        spacing: { after: 100 }
      }),
      new Paragraph({
        text: "✓ Native CRM integration (Salesforce, HubSpot auto-sync)",
        spacing: { after: 100 }
      }),
      new Paragraph({
        text: "✓ AI-powered relationship scoring (prioritize your best opportunities)",
        spacing: { after: 100 }
      }),
      new Paragraph({
        children: [
          new TextRun({ text: "✓ " }),
          new TextRun({ text: "90-Day ROI Guarantee", bold: true }),
          new TextRun({ text: " - See pipeline growth or money back" })
        ],
        spacing: { after: 300 }
      }),

      new Paragraph({
        text: "Time Delay (How Fast You Win)",
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 300, after: 200 }
      }),

      new Paragraph({
        text: "Revenue In 30 Days, Not 6 Months:",
        heading: HeadingLevel.HEADING_3,
        spacing: { after: 200 }
      }),

      new Paragraph({
        text: "• Day 1-7: CRM integration + historical champion mapping",
        spacing: { after: 100 }
      }),
      new Paragraph({
        text: "• Day 8-14: First job change alerts delivered",
        spacing: { after: 100 }
      }),
      new Paragraph({
        text: "• Day 15-30: First meetings booked with relocated champions",
        spacing: { after: 100 }
      }),
      new Paragraph({
        text: "• Month 2+: Consistent 15-25% of pipeline from champion tracking",
        spacing: { after: 300 }
      }),

      new Paragraph({
        text: "Effort & Sacrifice (What You DON'T Do)",
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 300, after: 200 }
      }),

      new Paragraph({
        text: "Zero Lift For Your Team:",
        heading: HeadingLevel.HEADING_3,
        spacing: { after: 200 }
      }),

      new Paragraph({
        text: "✗ No manual LinkedIn stalking",
        spacing: { after: 100 }
      }),
      new Paragraph({
        text: "✗ No CSV uploads or data entry",
        spacing: { after: 100 }
      }),
      new Paragraph({
        text: "✗ No complex workflows to build",
        spacing: { after: 100 }
      }),
      new Paragraph({
        text: "✗ No training required (works inside your CRM)",
        spacing: { after: 100 }
      }),
      new Paragraph({
        text: "✗ No additional tools to monitor",
        spacing: { after: 200 }
      }),

      new Paragraph({
        text: "One-Click Activation → Automatic Revenue",
        heading: HeadingLevel.HEADING_3,
        alignment: AlignmentType.CENTER,
        spacing: { after: 400 }
      }),

      // PAGE 2
      new Paragraph({
        text: "PAGE 2: PRICING STRATEGIES & MODELS",
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 400, after: 300 }
      }),

      new Paragraph({
        text: "Strategy #1: VALUE-BASED PRICING (Recommended)",
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 300, after: 200 }
      }),

      new Paragraph({
        children: [
          new TextRun({ text: "Price based on pipeline value generated, not contacts tracked", italics: true })
        ],
        spacing: { after: 200 }
      }),

      new Paragraph({
        text: "The ROI Promise:",
        heading: HeadingLevel.HEADING_3,
        spacing: { after: 200 }
      }),

      new Paragraph({
        text: "• Average customer generates $250k annual pipeline from champion tracking",
        spacing: { after: 100 }
      }),
      new Paragraph({
        text: "• Buyerwatch costs = 10-15% of pipeline value created",
        spacing: { after: 100 }
      }),
      new Paragraph({
        children: [
          new TextRun({ text: "• " }),
          new TextRun({ text: "Pricing: $2,500-3,750/month", bold: true }),
          new TextRun({ text: " (enterprise-wide)" })
        ],
        spacing: { after: 200 }
      }),

      new Paragraph({
        children: [
          new TextRun({ text: "Why This Works: ", bold: true }),
          new TextRun({ text: "Aligns our success with yours. If we don't create 10X value, you shouldn't pay premium prices." })
        ],
        spacing: { after: 300 }
      }),

      new Paragraph({
        text: "Strategy #2: COMPETITIVE DISRUPTION",
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 300, after: 200 }
      }),

      new Paragraph({
        children: [
          new TextRun({ text: "Undercut Champify/UserGems by 30-40% with equal/better features", italics: true })
        ],
        spacing: { after: 200 }
      }),

      new Paragraph({
        text: "Market Position:",
        heading: HeadingLevel.HEADING_3,
        spacing: { after: 200 }
      }),

      new Paragraph({
        text: "• Champify Core: $2,000/mo (15k contacts)",
        spacing: { after: 100 }
      }),
      new Paragraph({
        text: "• UserGems: $3,000-10,000/mo",
        spacing: { after: 100 }
      }),
      new Paragraph({
        children: [
          new TextRun({ text: "• " }),
          new TextRun({ text: "Buyerwatch: $1,399/mo (unlimited contacts)", bold: true })
        ],
        spacing: { after: 200 }
      }),

      new Paragraph({
        children: [
          new TextRun({ text: "Positioning: ", bold: true }),
          new TextRun({ text: "\"Enterprise features at startup prices - because every revenue team deserves champion tracking, not just Fortune 500.\"" })
        ],
        spacing: { after: 300 }
      }),

      new Paragraph({
        text: "Strategy #3: LAND & EXPAND",
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 300, after: 200 }
      }),

      new Paragraph({
        children: [
          new TextRun({ text: "Start small, prove value, scale with usage", italics: true })
        ],
        spacing: { after: 200 }
      }),

      new Paragraph({
        text: "Entry Point:",
        heading: HeadingLevel.HEADING_3,
        spacing: { after: 200 }
      }),

      new Paragraph({
        text: "• $499/mo starter (up to 5,000 contacts)",
        spacing: { after: 100 }
      }),
      new Paragraph({
        text: "• Prove ROI in 60 days",
        spacing: { after: 100 }
      }),
      new Paragraph({
        text: "• Expand to $1,999/mo growth tier",
        spacing: { after: 100 }
      }),
      new Paragraph({
        text: "• Enterprise at $4,999/mo",
        spacing: { after: 200 }
      }),

      new Paragraph({
        children: [
          new TextRun({ text: "Why This Works: ", bold: true }),
          new TextRun({ text: "Removes risk, builds trust, captures upmarket customers after they see results." })
        ],
        spacing: { after: 400 }
      }),

      // PAGE 3
      new Paragraph({
        text: "PAGE 3: PRICING PLANS & FINAL OFFER",
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 400, after: 300 }
      }),

      new Paragraph({
        text: "PLAN 1: ESSENTIALS",
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 300, after: 200 }
      }),

      new Paragraph({
        children: [
          new TextRun({ text: "$799/month", bold: true, size: 28 }),
          new TextRun({ text: " (annual: $7,990 - save 17%)" })
        ],
        spacing: { after: 200 }
      }),

      new Paragraph({
        text: "• 10,000 contacts monitored",
        spacing: { after: 100 }
      }),
      new Paragraph({
        text: "• Job change alerts (email + Slack)",
        spacing: { after: 100 }
      }),
      new Paragraph({
        text: "• CRM auto-sync (Salesforce/HubSpot)",
        spacing: { after: 100 }
      }),
      new Paragraph({
        text: "• Basic relationship scoring",
        spacing: { after: 100 }
      }),
      new Paragraph({
        text: "• Monthly data refresh",
        spacing: { after: 100 }
      }),
      new Paragraph({
        text: "• Email support",
        spacing: { after: 200 }
      }),

      new Paragraph({
        children: [
          new TextRun({ text: "Best For: ", bold: true }),
          new TextRun({ text: "Small teams (5-15 reps) testing champion tracking" })
        ],
        spacing: { after: 300 }
      }),

      new Paragraph({
        text: "PLAN 2: PROFESSIONAL (MOST POPULAR)",
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 300, after: 200 }
      }),

      new Paragraph({
        children: [
          new TextRun({ text: "$1,999/month", bold: true, size: 28 }),
          new TextRun({ text: " (annual: $19,990 - save 17%)" })
        ],
        spacing: { after: 200 }
      }),

      new Paragraph({
        text: "• 50,000 contacts monitored",
        spacing: { after: 100 }
      }),
      new Paragraph({
        text: "• Real-time alerts (< 48 hour detection)",
        spacing: { after: 100 }
      }),
      new Paragraph({
        text: "• AI relationship scoring + recommendations",
        spacing: { after: 100 }
      }),
      new Paragraph({
        text: "• Buying committee mapping",
        spacing: { after: 100 }
      }),
      new Paragraph({
        text: "• Weekly data refresh",
        spacing: { after: 100 }
      }),
      new Paragraph({
        text: "• Priority support + CSM",
        spacing: { after: 100 }
      }),
      new Paragraph({
        children: [
          new TextRun({ text: "• " }),
          new TextRun({ text: "BONUS:", bold: true }),
          new TextRun({ text: " ChurnWatch (track customer departures)" })
        ],
        spacing: { after: 200 }
      }),

      new Paragraph({
        children: [
          new TextRun({ text: "Best For: ", bold: true }),
          new TextRun({ text: "Mid-market teams (15-50 reps) scaling pipeline" })
        ],
        spacing: { after: 300 }
      }),

      new Paragraph({
        text: "PLAN 3: ENTERPRISE",
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 300, after: 200 }
      }),

      new Paragraph({
        children: [
          new TextRun({ text: "$4,999/month", bold: true, size: 28 }),
          new TextRun({ text: " (annual: $49,990 - save 17%)" })
        ],
        spacing: { after: 200 }
      }),

      new Paragraph({
        text: "• Unlimited contacts",
        spacing: { after: 100 }
      }),
      new Paragraph({
        text: "• Instant alerts (< 24 hour detection)",
        spacing: { after: 100 }
      }),
      new Paragraph({
        text: "• Insider AI (account intelligence)",
        spacing: { after: 100 }
      }),
      new Paragraph({
        text: "• Multi-CRM sync (Salesforce + HubSpot + custom)",
        spacing: { after: 100 }
      }),
      new Paragraph({
        text: "• Daily data enrichment",
        spacing: { after: 100 }
      }),
      new Paragraph({
        text: "• Dedicated CSM + Slack channel",
        spacing: { after: 100 }
      }),
      new Paragraph({
        text: "• Custom playbooks + training",
        spacing: { after: 100 }
      }),
      new Paragraph({
        text: "• API access",
        spacing: { after: 100 }
      }),
      new Paragraph({
        children: [
          new TextRun({ text: "• " }),
          new TextRun({ text: "BONUS:", bold: true }),
          new TextRun({ text: " Executive Mobility Index (C-suite tracking)" })
        ],
        spacing: { after: 200 }
      }),

      new Paragraph({
        children: [
          new TextRun({ text: "Best For: ", bold: true }),
          new TextRun({ text: "Enterprise teams (50+ reps) or PE portfolio tracking" })
        ],
        spacing: { after: 300 }
      }),

      new Paragraph({
        text: "THE GRAND SLAM GUARANTEE",
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 400, after: 200 }
      }),

      new Paragraph({
        text: "90-Day Revenue Guarantee:",
        heading: HeadingLevel.HEADING_3,
        spacing: { after: 200 }
      }),

      new Paragraph({
        text: "If Buyerwatch doesn't generate at least 10 qualified meetings from champion job changes in your first 90 days, we'll refund 100% AND give you 3 months free to keep trying.",
        spacing: { after: 200 }
      }),

      new Paragraph({
        text: "The Math:",
        heading: HeadingLevel.HEADING_3,
        spacing: { after: 200 }
      }),

      new Paragraph({
        text: "• 10 meetings × 20% close rate = 2 deals",
        spacing: { after: 100 }
      }),
      new Paragraph({
        text: "• Average deal size × 2 = Likely covers 12-24 months of Buyerwatch",
        spacing: { after: 100 }
      }),
      new Paragraph({
        children: [
          new TextRun({ text: "• " }),
          new TextRun({ text: "Risk: $0 | Upside: Unlimited", bold: true })
        ],
        spacing: { after: 300 }
      }),

      new Paragraph({
        text: "STACK THE VALUE (Limited-Time Bonuses)",
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 400, after: 200 }
      }),

      new Paragraph({
        text: "Sign by Feb 15, 2026:",
        heading: HeadingLevel.HEADING_3,
        spacing: { after: 200 }
      }),

      new Paragraph({
        text: "1. Free 6-month ChurnWatch upgrade ($5,994 value)",
        spacing: { after: 100 }
      }),
      new Paragraph({
        text: "2. 1:1 revenue playbook with our VP Sales ($2,500 value)",
        spacing: { after: 100 }
      }),
      new Paragraph({
        text: "3. Custom Salesforce dashboard build ($3,000 value)",
        spacing: { after: 100 }
      }),
      new Paragraph({
        text: "4. Lock in pricing for 24 months (inflation protection)",
        spacing: { after: 200 }
      }),

      new Paragraph({
        children: [
          new TextRun({ text: "Total Bonus Value: $11,494", bold: true, size: 28 })
        ],
        spacing: { after: 300 }
      }),

      new Paragraph({
        text: "THE CLOSE",
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 400, after: 200 }
      }),

      new Paragraph({
        text: "The No-Brainer Offer:",
        heading: HeadingLevel.HEADING_3,
        spacing: { after: 200 }
      }),

      new Paragraph({
        text: "• Professional Plan: $1,999/mo",
        spacing: { after: 100 }
      }),
      new Paragraph({
        text: "• Bonuses: $11,494 value",
        spacing: { after: 100 }
      }),
      new Paragraph({
        text: "• Guarantee: Full refund if no results",
        spacing: { after: 100 }
      }),
      new Paragraph({
        text: "• Total Investment: $23,988/year",
        spacing: { after: 100 }
      }),
      new Paragraph({
        text: "• Expected Pipeline: $250,000+",
        spacing: { after: 200 }
      }),

      new Paragraph({
        children: [
          new TextRun({ text: "Your Cost Per Deal: $240 (vs $3,500 industry average CAC)", bold: true, size: 24 })
        ],
        spacing: { after: 300 }
      }),

      new Paragraph({
        text: "Take Action:",
        heading: HeadingLevel.HEADING_3,
        spacing: { after: 200 }
      }),

      new Paragraph({
        text: "Book demo: buyerwatch@selling.com",
        spacing: { after: 100 }
      }),
      new Paragraph({
        text: "Start 14-day trial (no CC required): selling.com/buyerwatch",
        spacing: { after: 400 }
      }),

      new Paragraph({
        children: [
          new TextRun({
            text: "Pricing based on competitive analysis vs Champify ($2k-6k/mo) and UserGems ($3k-20k/mo). Hormozi Value Equation applied to maximize dream outcome (6X conversion), likelihood (90-day guarantee), minimize time (30-day results), and effort (zero-lift automation).",
            italics: true,
            size: 18
          })
        ],
        spacing: { before: 400 }
      })
    ]
  }]
});

Packer.toBuffer(doc).then(buffer => {
  try {
    fs.writeFileSync('C:\\Users\\adasb\\Desktop\\Buyerwatch_Offer_Document.docx', buffer);
    console.log('Word document created successfully!');
  } catch (writeError) {
    console.error('Error writing Word document to disk:', writeError.message);
  }
}).catch(packError => {
  console.error('Error generating Word document buffer:', packError.message);
});
