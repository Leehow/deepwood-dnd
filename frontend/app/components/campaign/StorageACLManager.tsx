import { useEffect, useMemo, useState } from "react";
import { Box, Button, Flex, Separator, Text, TextField, Callout, Badge } from "@radix-ui/themes";
import { CampaignStorageAPI } from "~/services/campaignStorage";

interface Props {
  campaignId: string;
  objectType: string;
  objectId: string;
  visibility: "dm_only" | "all_players" | "specific_players";
  isDM: boolean;
}

export function StorageACLManager({ campaignId, objectType, objectId, visibility, isDM }: Props) {
  const [users, setUsers] = useState<string[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [inputUser, setInputUser] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const actionable = useMemo(() => isDM && visibility === "specific_players", [isDM, visibility]);

  useEffect(() => {
    if (!actionable) {
      setUsers(null);
      return;
    }
    let mounted = true;
    (async () => {
      try {
        setLoading(true);
        const list = await CampaignStorageAPI.listACL(campaignId, objectType, objectId);
        if (mounted) setUsers(list);
      } catch (e: any) {
        if (mounted) setError(e?.message || "Failed to load ACL");
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, [campaignId, objectType, objectId, actionable]);

  const handleAdd = async () => {
    if (!inputUser.trim()) return;
    setAdding(true);
    setError(null);
    try {
      const list = await CampaignStorageAPI.addACL(campaignId, objectType, objectId, inputUser.trim());
      setUsers(list);
      setInputUser("");
    } catch (e: any) {
      setError(e?.message || "Failed to add user");
    } finally {
      setAdding(false);
    }
  };

  const handleRemove = async (uid: string) => {
    setError(null);
    try {
      const list = await CampaignStorageAPI.removeACL(campaignId, objectType, objectId, uid);
      setUsers(list);
    } catch (e: any) {
      setError(e?.message || "Failed to remove user");
    }
  };

  if (visibility !== "specific_players") {
    return (
      <Box>
        <Text size="2" color="gray">Visibility is {visibility}. No ACL needed.</Text>
      </Box>
    );
  }

  if (!isDM) {
    return (
      <Callout.Root color="amber">
        <Callout.Text>Only DM can manage ACL for this object.</Callout.Text>
      </Callout.Root>
    );
  }

  return (
    <Box>
      <Flex align="center" justify="between" mb="2">
        <Text weight="bold">Access Control List</Text>
        {loading && <Text size="1" color="gray">Loading...</Text>}
      </Flex>
      {error && (
        <Callout.Root color="red" mb="2"><Callout.Text>{error}</Callout.Text></Callout.Root>
      )}

      <Flex gap="2" align="center" mb="3">
        <TextField.Root
          placeholder="Enter user_id"
          value={inputUser}
          onChange={(e) => setInputUser(e.target.value)}
          style={{ maxWidth: 220 }}
        />
        <Button size="2" onClick={handleAdd} disabled={adding || !inputUser.trim()}>
          {adding ? "Adding..." : "Add"}
        </Button>
      </Flex>

      <Separator my="2" />
      <Flex gap="2" wrap="wrap">
        {(users || []).length === 0 ? (
          <Text size="2" color="gray">No users yet.</Text>
        ) : (
          users!.map((u) => (
            <Flex key={u} align="center" gap="2" style={{ border: "1px solid var(--gray-6)", padding: 6, borderRadius: 6 }}>
              <Badge color="gray" variant="soft">{u}</Badge>
              <Button size="1" variant="soft" color="red" onClick={() => handleRemove(u)}>Remove</Button>
            </Flex>
          ))
        )}
      </Flex>
    </Box>
  );
}

