import { Document, Page, Text, View, Image, StyleSheet, Font } from '@react-pdf/renderer'
import type { LetterData } from './letter-data'

// Disable @react-pdf's automatic hyphenation — with justified text it inserted
// stray hyphens at line breaks (e.g. "gift.-"). Words now wrap whole.
Font.registerHyphenationCallback((word) => [word])

// A plain serif (Times) letter: centered letterhead with the EIN, justified
// body. The wording comes from letter-data.ts (based on IRS Pub 1771; have
// your own accountant or counsel review it).
const styles = StyleSheet.create({
  page: {
    paddingTop: 72,
    paddingBottom: 72,
    paddingHorizontal: 72,
    fontSize: 11,
    fontFamily: 'Times-Roman',
    lineHeight: 1.15,
    color: '#000000',
  },
  header: {
    marginBottom: 28,
    textAlign: 'center',
  },
  orgName: {
    fontSize: 12,
    fontFamily: 'Times-Bold',
    marginBottom: 2,
  },
  date: {
    marginBottom: 18,
  },
  block: {
    marginBottom: 14,
  },
  body: {
    marginBottom: 14,
    textAlign: 'justify',
  },
  signatureSpace: {
    height: 40,
  },
  signatureImage: {
    // ~0.5in wide, exact 1.75 source aspect ratio (420x240).
    width: 36,
    height: 20.6,
    marginTop: 6,
    marginBottom: 2,
  },
})

export default function AcknowledgementLetter({
  data,
  signature,
}: {
  data: LetterData
  signature?: string | null
}) {
  return (
    <Document
      title={`Gift acknowledgement - ${data.recipientLines[0] ?? data.orgLegalName}`}
      author={data.orgLegalName}
    >
      <Page size="LETTER" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.orgName}>{data.orgLegalName}</Text>
          {data.orgAddressLines.map((line, i) => (
            <Text key={`addr-${i}`}>{line}</Text>
          ))}
          <Text>FEIN: {data.ein}</Text>
        </View>

        <Text style={styles.date}>{data.letterDate}</Text>

        <View style={styles.block}>
          {data.recipientLines.map((line, i) => (
            <Text key={`rcpt-${i}`}>{line}</Text>
          ))}
        </View>

        <View style={styles.block}>
          <Text>{data.salutation}</Text>
        </View>

        <Text style={styles.body}>{data.giftParagraph}</Text>
        {data.inKindNote ? <Text style={styles.body}>{data.inKindNote}</Text> : null}
        <Text style={styles.body}>{data.deductibilityParagraph}</Text>
        <Text style={styles.body}>{data.goodsServicesParagraph}</Text>

        <Text style={styles.block}>{data.closingLine}</Text>

        <View>
          <Text>Sincerely,</Text>
          {signature ? (
            // eslint-disable-next-line jsx-a11y/alt-text
            <Image src={signature} style={styles.signatureImage} />
          ) : (
            <View style={styles.signatureSpace} />
          )}
          <Text>{data.signatoryName}</Text>
          <Text>{data.signatoryTitle}</Text>
        </View>
      </Page>
    </Document>
  )
}
