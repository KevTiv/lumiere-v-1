//! Small helpers shared by every pipeline: reading, writing, env overrides.

use anyhow::{Context, Result};
use std::fs;
use std::io::ErrorKind;
use std::path::Path;

pub fn env_or_default(key: &str, default: &str) -> String {
    std::env::var(key).unwrap_or_else(|_| default.to_string())
}

pub fn write_file(path: &Path, contents: &str) -> Result<()> {
    match fs::read(path) {
        Ok(existing) if existing == contents.as_bytes() => return Ok(()),
        Ok(_) => {}
        Err(error) if error.kind() == ErrorKind::NotFound => {}
        Err(error) => return Err(error).with_context(|| format!("read {}", path.display())),
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).with_context(|| format!("mkdir {}", parent.display()))?;
    }
    fs::write(path, contents).with_context(|| format!("write {}", path.display()))
}

pub fn read_to_string(path: &Path) -> Result<String> {
    fs::read_to_string(path).with_context(|| format!("read {}", path.display()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::{File, FileTimes};
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::time::{Duration, SystemTime};

    struct TestDirectory(PathBuf);

    impl TestDirectory {
        fn new() -> Self {
            static NEXT_ID: AtomicUsize = AtomicUsize::new(0);
            let path = std::env::temp_dir().join(format!(
                "lumiere-codegen-write-{}-{}",
                std::process::id(),
                NEXT_ID.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir(&path).unwrap();
            Self(path)
        }
    }

    impl Drop for TestDirectory {
        fn drop(&mut self) {
            fs::remove_dir_all(&self.0).unwrap();
        }
    }

    #[test]
    fn unchanged_output_preserves_mtime() {
        let directory = TestDirectory::new();
        let path = directory.0.join("generated.rs");
        write_file(&path, "generated contents\n").unwrap();
        let fixed_time = SystemTime::UNIX_EPOCH + Duration::from_secs(1_000_000);
        File::open(&path)
            .unwrap()
            .set_times(FileTimes::new().set_modified(fixed_time))
            .unwrap();
        let before = fs::metadata(&path).unwrap().modified().unwrap();

        write_file(&path, "generated contents\n").unwrap();

        assert_eq!(fs::metadata(&path).unwrap().modified().unwrap(), before);
    }

    #[test]
    fn creates_parent_directories_and_replaces_changed_contents() {
        let directory = TestDirectory::new();
        let path = directory.0.join("nested/generated.rs");

        write_file(&path, "first\n").unwrap();
        write_file(&path, "second\n").unwrap();

        assert_eq!(fs::read_to_string(path).unwrap(), "second\n");
    }

    #[test]
    fn existing_output_read_errors_are_not_treated_as_missing_files() {
        let directory = TestDirectory::new();
        let error = write_file(&directory.0, "generated contents\n").unwrap_err();

        assert_eq!(error.to_string(), format!("read {}", directory.0.display()));
        assert!(directory.0.is_dir());
    }
}
