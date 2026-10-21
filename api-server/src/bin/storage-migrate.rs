//! Apply migrations, or inspect their lineage without changing PostgreSQL.

#[derive(Debug, PartialEq, Eq)]
enum Mode {
    Apply,
    Audit,
    Verify,
    Help,
}

fn mode(args: &[String]) -> anyhow::Result<Mode> {
    match args {
        [] => Ok(Mode::Apply),
        [argument] => match argument.as_str() {
            "--apply" => Ok(Mode::Apply),
            "--audit" => Ok(Mode::Audit),
            "--verify" => Ok(Mode::Verify),
            "--help" | "-h" => Ok(Mode::Help),
            _ => anyhow::bail!("unknown argument; use storage-migrate --help"),
        },
        _ => anyhow::bail!("choose exactly one storage-migrate mode"),
    }
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let selected_mode = mode(&std::env::args().skip(1).collect::<Vec<_>>())?;
    match selected_mode {
        Mode::Apply => {
            api_server::run_storage_migrations().await?;
            println!("PostgreSQL storage migrations applied and verified successfully");
        }
        Mode::Audit | Mode::Verify => {
            let report = api_server::audit_storage_migrations().await?;
            println!("{}", serde_json::to_string_pretty(&report)?);
            report.require_compatible()?;
            if selected_mode == Mode::Verify {
                report.require_current()?;
            }
        }
        Mode::Help => println!(
            "Usage: storage-migrate [--apply|--audit|--verify]\n\
             Default / --apply: apply checksum-verified migrations.\n\
             --audit: read-only JSON lineage report; pending or uninitialized history is allowed.\n\
             --verify: read-only JSON lineage report; require the complete matching catalog.\n\
             Both read-only modes reject conflicting or unknown future history, inspect only\n\
             migration metadata, and never bootstrap, adopt, apply or acquire migration locks."
        ),
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn read_only_modes_never_fall_back_to_apply() {
        assert_eq!(mode(&[]).unwrap(), Mode::Apply);
        for (argument, expected) in [("--audit", Mode::Audit), ("--verify", Mode::Verify)] {
            assert_eq!(mode(&[argument.into()]).unwrap(), expected);
        }
        assert!(mode(&["--audit".into(), "--apply".into()]).is_err());
        assert!(mode(&["--verfy".into()]).is_err());
    }
}
