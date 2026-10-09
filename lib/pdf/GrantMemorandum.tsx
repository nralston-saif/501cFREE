import { Document, Page, Text, View, StyleSheet, Font } from '@react-pdf/renderer'
import type { MemoData } from './memo-data'

// Disable @react-pdf's automatic hyphenation — with justified text it inserts
// stray hyphens at line breaks. Words wrap whole. (Same as the letter template.)
Font.registerHyphenationCallback((word) => [word])

// Classic foundation grant-memorandum layout: Times, bold title, ruled header
// key/value table, ten numbered prose sections, page numbers in the footer.
const styles = StyleSheet.create({
  page: {
    paddingTop: 72,
    paddingBottom: 72,
    paddingHorizontal: 72,
    fontSize: 11,
    fontFamily: 'Times-Roman',
    lineHeight: 1.25,
    color: '#000000',
  },
  title: {
    fontSize: 18,
    fontFamily: 'Times-Bold',
  },
  subtitle: {
    fontSize: 10,
    marginTop: 2,
    marginBottom: 16,
  },
  headerTable: {
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#000000',
    marginBottom: 18,
  },
  headerRow: {
    flexDirection: 'row',
    borderTopWidth: 0.5,
    borderColor: '#999999',
    paddingVertical: 6,
  },
  headerRowFirst: {
    flexDirection: 'row',
    paddingVertical: 6,
  },
  headerLabel: {
    width: 120,
    fontFamily: 'Times-Bold',
    paddingRight: 8,
  },
  headerValue: {
    flex: 1,
  },
  sectionHeading: {
    fontSize: 12,
    fontFamily: 'Times-Bold',
    marginTop: 14,
    marginBottom: 5,
  },
  paragraph: {
    marginBottom: 8,
    textAlign: 'justify',
  },
  footer: {
    position: 'absolute',
    bottom: 36,
    left: 72,
    right: 72,
    flexDirection: 'row',
    justifyContent: 'space-between',
    fontSize: 9,
    color: '#666666',
  },
})

function paragraphs(body: string): string[] {
  return body
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
}

export default function GrantMemorandum({ data }: { data: MemoData }) {
  return (
    <Document
      title={`${data.title ?? 'Grant Memorandum'} - ${data.granteeName}`}
      author={data.orgLegalName}
    >
      <Page size="LETTER" style={styles.page}>
        <Text style={styles.title}>{data.title ?? 'Grant Memorandum'}</Text>
        <Text style={styles.subtitle}>{data.subtitle}</Text>

        <View style={styles.headerTable}>
          {data.headerRows.map((row, i) => (
            <View key={row.label} style={i === 0 ? styles.headerRowFirst : styles.headerRow}>
              <Text style={styles.headerLabel}>{row.label}</Text>
              <View style={styles.headerValue}>
                {row.lines.map((line, j) => (
                  <Text key={`${row.label}-${j}`}>{line}</Text>
                ))}
              </View>
            </View>
          ))}
        </View>

        {data.sections.map((section) => (
          <View key={section.number}>
            {/* minPresenceAhead keeps a heading from orphaning at a page bottom */}
            <Text style={styles.sectionHeading} minPresenceAhead={40}>
              {section.number}. {section.heading}
            </Text>
            {paragraphs(section.body).map((p, i) => (
              <Text key={`${section.number}-${i}`} style={styles.paragraph}>
                {p}
              </Text>
            ))}
          </View>
        ))}

        <View style={styles.footer} fixed>
          <Text>
            {data.orgLegalName} · Generated {data.generatedDate}
          </Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  )
}
