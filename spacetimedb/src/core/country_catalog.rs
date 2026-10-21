//! Fixed onboarding reference data, not company tax policy or a complete ISO catalog.
//! These factual identifiers are intentionally independent of caller input.

pub(crate) struct CountryDefinition {
    pub code: &'static str,
    pub name: &'static str,
    pub iso3: &'static str,
    pub numcode: u16,
    pub phone_code: &'static str,
    pub currency_code: &'static str,
    pub languages: &'static [&'static str],
}

pub(crate) const COUNTRIES: &[CountryDefinition] = &[
    CountryDefinition {
        code: "AU",
        name: "Australia",
        iso3: "AUS",
        numcode: 36,
        phone_code: "61",
        currency_code: "AUD",
        languages: &["en"],
    },
    CountryDefinition {
        code: "CA",
        name: "Canada",
        iso3: "CAN",
        numcode: 124,
        phone_code: "1",
        currency_code: "CAD",
        languages: &["en", "fr"],
    },
    CountryDefinition {
        code: "GB",
        name: "United Kingdom",
        iso3: "GBR",
        numcode: 826,
        phone_code: "44",
        currency_code: "GBP",
        languages: &["en"],
    },
    CountryDefinition {
        code: "JP",
        name: "Japan",
        iso3: "JPN",
        numcode: 392,
        phone_code: "81",
        currency_code: "JPY",
        languages: &["ja"],
    },
    CountryDefinition {
        code: "NL",
        name: "Netherlands",
        iso3: "NLD",
        numcode: 528,
        phone_code: "31",
        currency_code: "EUR",
        languages: &["nl", "en"],
    },
    CountryDefinition {
        code: "RW",
        name: "Rwanda",
        iso3: "RWA",
        numcode: 646,
        phone_code: "250",
        currency_code: "RWF",
        languages: &["rw", "en", "fr"],
    },
    CountryDefinition {
        code: "US",
        name: "United States",
        iso3: "USA",
        numcode: 840,
        phone_code: "1",
        currency_code: "USD",
        languages: &["en"],
    },
];

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeSet;

    #[test]
    fn country_identifiers_are_unique_and_well_formed() {
        let mut codes = BTreeSet::new();
        let mut alpha3 = BTreeSet::new();
        let mut numeric = BTreeSet::new();
        for country in COUNTRIES {
            assert!(codes.insert(country.code));
            assert!(alpha3.insert(country.iso3));
            assert!(numeric.insert(country.numcode));
            assert_eq!(country.code.len(), 2);
            assert_eq!(country.iso3.len(), 3);
            assert_eq!(country.currency_code.len(), 3);
            assert!(country.code.bytes().all(|b| b.is_ascii_uppercase()));
            assert!(country.phone_code.bytes().all(|b| b.is_ascii_digit()));
            assert!(!country.name.is_empty());
            assert!(!country.languages.is_empty());
        }
    }

    #[test]
    fn netherlands_reference_matches_alpha_tax_dependency() {
        let nl = COUNTRIES
            .iter()
            .find(|country| country.code == "NL")
            .expect("NL catalog entry");
        assert_eq!(
            (nl.iso3, nl.numcode, nl.phone_code, nl.currency_code),
            ("NLD", 528, "31", "EUR")
        );
        assert_eq!(nl.languages, &["nl", "en"]);
    }

    #[test]
    fn rwanda_reference_uses_rwandan_franc() {
        let rw = COUNTRIES
            .iter()
            .find(|country| country.code == "RW")
            .expect("RW catalog entry");
        assert_eq!(
            (rw.iso3, rw.numcode, rw.phone_code, rw.currency_code),
            ("RWA", 646, "250", "RWF")
        );
        assert_eq!(rw.languages, &["rw", "en", "fr"]);
    }
}
