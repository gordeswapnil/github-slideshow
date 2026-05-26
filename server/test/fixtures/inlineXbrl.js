// A trimmed, synthetic inline-XBRL document that mirrors how a real 10-K encodes
// dimensional (segment / geographic / product) revenue facts. Used to test the
// segment parser without hitting the network.
//
// scale="3" means the displayed value is value x 10^3 (reported in thousands).
module.exports = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns:ix="http://www.xbrl.org/2013/inlineXBRL"
      xmlns:xbrli="http://www.xbrl.org/2003/instance"
      xmlns:xbrldi="http://xbrl.org/2006/xbrldi">
<body>
<ix:header><ix:resources>
  <xbrli:context id="cProd2024Stream">
    <xbrli:period><xbrli:startDate>2024-01-01</xbrli:startDate><xbrli:endDate>2024-12-31</xbrli:endDate></xbrli:period>
    <xbrli:entity><xbrli:segment>
      <xbrldi:explicitMember dimension="srt:ProductOrServiceAxis">nflx:StreamingRevenuesMember</xbrldi:explicitMember>
    </xbrli:segment></xbrli:entity>
  </xbrli:context>
  <xbrli:context id="cProd2024DVD">
    <xbrli:period><xbrli:startDate>2024-01-01</xbrli:startDate><xbrli:endDate>2024-12-31</xbrli:endDate></xbrli:period>
    <xbrli:entity><xbrli:segment>
      <xbrldi:explicitMember dimension="srt:ProductOrServiceAxis">nflx:DvdRevenuesMember</xbrldi:explicitMember>
    </xbrli:segment></xbrli:entity>
  </xbrli:context>
  <xbrli:context id="cProd2023Stream">
    <xbrli:period><xbrli:startDate>2023-01-01</xbrli:startDate><xbrli:endDate>2023-12-31</xbrli:endDate></xbrli:period>
    <xbrli:entity><xbrli:segment>
      <xbrldi:explicitMember dimension="srt:ProductOrServiceAxis">nflx:StreamingRevenuesMember</xbrldi:explicitMember>
    </xbrli:segment></xbrli:entity>
  </xbrli:context>
  <xbrli:context id="cGeo2024US">
    <xbrli:period><xbrli:startDate>2024-01-01</xbrli:startDate><xbrli:endDate>2024-12-31</xbrli:endDate></xbrli:period>
    <xbrli:entity><xbrli:segment>
      <xbrldi:explicitMember dimension="srt:StatementGeographicalAxis">country:US</xbrldi:explicitMember>
    </xbrli:segment></xbrli:entity>
  </xbrli:context>
  <xbrli:context id="cConsolidated2024">
    <xbrli:period><xbrli:startDate>2024-01-01</xbrli:startDate><xbrli:endDate>2024-12-31</xbrli:endDate></xbrli:period>
    <xbrli:entity></xbrli:entity>
  </xbrli:context>
  <xbrli:context id="cProdQ12024">
    <xbrli:period><xbrli:startDate>2024-01-01</xbrli:startDate><xbrli:endDate>2024-03-31</xbrli:endDate></xbrli:period>
    <xbrli:entity><xbrli:segment>
      <xbrldi:explicitMember dimension="srt:ProductOrServiceAxis">nflx:StreamingRevenuesMember</xbrldi:explicitMember>
    </xbrli:segment></xbrli:entity>
  </xbrli:context>
  <xbrli:context id="cProdGeo2024">
    <xbrli:period><xbrli:startDate>2024-01-01</xbrli:startDate><xbrli:endDate>2024-12-31</xbrli:endDate></xbrli:period>
    <xbrli:entity><xbrli:segment>
      <xbrldi:explicitMember dimension="srt:ProductOrServiceAxis">nflx:StreamingRevenuesMember</xbrldi:explicitMember>
      <xbrldi:explicitMember dimension="srt:StatementGeographicalAxis">country:US</xbrldi:explicitMember>
    </xbrli:segment></xbrli:entity>
  </xbrli:context>
</ix:resources></ix:header>

<p>Streaming product revenue FY24:
  <ix:nonFraction name="us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax"
    contextRef="cProd2024Stream" unitRef="usd" scale="3" decimals="-3">38000000</ix:nonFraction></p>
<p>DVD product revenue FY24:
  <ix:nonFraction name="us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax"
    contextRef="cProd2024DVD" unitRef="usd" scale="3" decimals="-3">1000000</ix:nonFraction></p>
<p>Streaming product revenue FY23:
  <ix:nonFraction name="us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax"
    contextRef="cProd2023Stream" unitRef="usd" scale="3" decimals="-3">33000000</ix:nonFraction></p>
<p>US geographic revenue FY24:
  <ix:nonFraction name="us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax"
    contextRef="cGeo2024US" unitRef="usd" scale="3" decimals="-3">15000000</ix:nonFraction></p>
<p>Consolidated revenue (no segment) FY24 - must be excluded:
  <ix:nonFraction name="us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax"
    contextRef="cConsolidated2024" unitRef="usd" scale="3" decimals="-3">39000000</ix:nonFraction></p>
<p>Q1 partial streaming revenue - must be excluded:
  <ix:nonFraction name="us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax"
    contextRef="cProdQ12024" unitRef="usd" scale="3" decimals="-3">9000000</ix:nonFraction></p>
<p>Product x geography intersection - must be excluded (multi-axis):
  <ix:nonFraction name="us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax"
    contextRef="cProdGeo2024" unitRef="usd" scale="3" decimals="-3">12000000</ix:nonFraction></p>
</body>
</html>`;
