{
  inputs = {
    local-test.url = "path:../local-flake-repo";
  };

  outputs = { self, local-test }: {
    # Test flake with local input
  };
}