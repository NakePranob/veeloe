//! The folders on a Machine an Agent may never be given (ADR 0087): the
//! owner's home itself, where secrets live, the Runtime's own folder and the
//! system. A folder is refused when it is one of these, holds one, or (for
//! the ones marked `inside`) sits inside one, by its real path, so a symlink
//! cannot lead around the list.

use std::path::{Path, PathBuf};

pub struct Forbidden {
    /// No home to protect was named (an empty `HOME`): every folder is refused,
    /// since the list cannot say where the secrets are.
    unknown_home: bool,
    /// Refused, and so is anything that holds them.
    exact: Vec<PathBuf>,
    /// Refused, with anything inside them and anything that holds them.
    inside: Vec<PathBuf>,
}

/// Where secrets live under a home, refused with everything inside them.
const SECRETS: &[&str] = &[
    ".ssh",
    ".gnupg",
    ".aws",
    ".config/gcloud",
    ".config/gh",
    ".kube",
    ".docker",
    ".npmrc",
    ".netrc",
    ".git-credentials",
    "Library/Keychains",
    "Library/Application Support/Google/Chrome",
    "Library/Application Support/Firefox",
    "Library/Application Support/BraveSoftware",
    "Library/Application Support/Arc",
    "Library/Safari",
    "Library/Cookies",
    ".config/google-chrome",
    ".config/chromium",
    ".config/BraveSoftware",
    ".mozilla",
];

/// The system's own folders: nothing inside them is a project.
const SYSTEM_INSIDE: &[&str] = &[
    "/System",
    "/usr",
    "/bin",
    "/sbin",
    "/etc",
    "/private/etc",
    "/dev",
    "/proc",
    "/sys",
    "/boot",
    "/root",
];

/// Folders that hold many others: refused themselves, not what is in them.
const SYSTEM_EXACT: &[&str] = &[
    "/",
    "/private",
    "/var",
    "/private/var",
    "/Users",
    "/home",
    "/Library",
    "/Applications",
    "/opt",
    "/Volumes",
    "/tmp",
    "/private/tmp",
    "/mnt",
    "/srv",
];

impl Forbidden {
    /// The list for this Machine: `home` is the owner's home, `runtime` the
    /// Runtime's own folder (`VEELOE_HOME`).
    pub fn for_machine(home: &Path, runtime: &Path) -> Self {
        let mut inside: Vec<PathBuf> = SECRETS.iter().map(|path| home.join(path)).collect();
        inside.push(runtime.to_path_buf());
        inside.extend(SYSTEM_INSIDE.iter().map(PathBuf::from));
        let mut exact: Vec<PathBuf> = SYSTEM_EXACT.iter().map(PathBuf::from).collect();
        exact.push(home.to_path_buf());
        Self {
            unknown_home: !home.is_absolute(),
            exact: exact.into_iter().map(|path| real(&path)).collect(),
            inside: inside.into_iter().map(|path| real(&path)).collect(),
        }
    }

    /// The real path of a folder an Agent may be given, or why not.
    pub fn check(&self, folder: &str) -> Result<PathBuf, &'static str> {
        if self.unknown_home {
            return Err("folder.forbidden");
        }
        let path = Path::new(folder);
        if !path.is_absolute() {
            return Err("folder.not_absolute");
        }
        let real = std::fs::canonicalize(path).map_err(|_| "folder.missing")?;
        if !real.is_dir() {
            return Err("folder.not_a_folder");
        }
        let holds = |forbidden: &PathBuf| forbidden.starts_with(&real);
        if self
            .exact
            .iter()
            .any(|forbidden| *forbidden == real || holds(forbidden))
        {
            return Err("folder.forbidden");
        }
        if self
            .inside
            .iter()
            .any(|forbidden| real.starts_with(forbidden) || holds(forbidden))
        {
            return Err("folder.forbidden");
        }
        Ok(real)
    }
}

/// The real path, or the path as given when it does not exist on this Machine.
fn real(path: &Path) -> PathBuf {
    std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn machine() -> (tempfile::TempDir, Forbidden, PathBuf) {
        let root = tempfile::tempdir().expect("root");
        let home = root.path().join("home");
        for dir in ["code/shop", ".ssh", ".veeloe"] {
            std::fs::create_dir_all(home.join(dir)).expect("dir");
        }
        let forbidden = Forbidden::for_machine(&home, &home.join(".veeloe"));
        (root, forbidden, home)
    }

    #[test]
    fn a_project_folder_is_given_and_the_home_and_secrets_are_not() {
        let (_root, forbidden, home) = machine();
        let shop = home.join("code/shop");
        assert_eq!(
            forbidden.check(shop.to_str().unwrap()),
            Ok(std::fs::canonicalize(&shop).unwrap())
        );
        for refused in [home.clone(), home.join(".ssh"), home.join(".veeloe")] {
            assert_eq!(
                forbidden.check(refused.to_str().unwrap()),
                Err("folder.forbidden")
            );
        }
        // The folder that holds the home holds .ssh too.
        assert_eq!(
            forbidden.check(home.parent().unwrap().to_str().unwrap()),
            Err("folder.forbidden")
        );
        assert_eq!(forbidden.check("/"), Err("folder.forbidden"));
        assert_eq!(forbidden.check("/usr/local"), Err("folder.forbidden"));
        assert_eq!(forbidden.check("code/shop"), Err("folder.not_absolute"));
    }

    #[test]
    fn without_a_home_to_protect_no_folder_is_given() {
        let (_root, _, home) = machine();
        let forbidden = Forbidden::for_machine(Path::new(""), &home.join(".veeloe"));
        assert_eq!(
            forbidden.check(home.join("code/shop").to_str().unwrap()),
            Err("folder.forbidden")
        );
    }

    #[test]
    fn a_symlink_into_a_secret_is_refused_by_where_it_leads() {
        let (_root, forbidden, home) = machine();
        let link = home.join("code/keys");
        std::os::unix::fs::symlink(home.join(".ssh"), &link).expect("symlink");
        assert_eq!(
            forbidden.check(link.to_str().unwrap()),
            Err("folder.forbidden")
        );
    }
}
