import { useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router";
import type { MetaFunction } from "react-router";
import { Box, Button, Card, Container, Flex, Heading, Select, Text, TextField, Separator, Callout, Badge } from "@radix-ui/themes";
import { getCurrentUserId } from "~/utils/user";
import { API_BASE_URL } from "~/config/api";
import type { CampaignStorageObject } from "~/types/campaign-storage";
import { CampaignStorageAPI } from "~/services/campaignStorage";
import { StorageACLManager } from "~/components/campaign/StorageACLManager";
import { useWebSocket } from "~/hooks/useWebSocket";

export const meta: MetaFunction = () => {
  return [
    { title: "Campaign Storage - DND 5E" },
  ];
};

export default function CampaignStorageRoute() {
  const params = useParams();
  const campaignId = params.id as string;
  const currentUserId = getCurrentUserId();

  const [isDM, setIsDM] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [objects, setObjects] = useState<CampaignStorageObject[]>([]);
  const [objectType, setObjectType] = useState<string>("");

  // Determine role by fetching campaign
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const resp = await fetch(`${API_BASE_URL}/api/campaigns/${campaignId}`);
        if (!resp.ok) throw new Error("Failed to load campaign");
        const data = await resp.json();
        if (mounted) setIsDM(String(data.dm_user_id) === String(currentUserId));
      } catch (e: any) {
        if (mounted) setError(e?.message || "Failed to load campaign");
      }
    })();
    return () => { mounted = false; };
  }, [campaignId, currentUserId]);

  const load = async () => {
    try {
      setLoading(true);
      const list = await CampaignStorageAPI.list(campaignId, { object_type: objectType || undefined });
      setObjects(list);
      setError(null);
    } catch (e: any) {
      setError(e?.message || "Failed to load storage objects");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId, objectType]);

  // WebSocket: refresh on ACL updates
  useWebSocket({
    campaignId: String(campaignId),
    userId: currentUserId,
    role: isDM ? "dm" : "player",
    onMessage: (msg) => {
      if (msg.type === "storage_acl_updated") {
        load();
      }
    }
  });

  return (
    <Box px={{ initial: "4", sm: "6", md: "8" }} py="6" style={{ paddingTop: "calc(1.5rem + var(--sat, 0px))" }}>
      <Container size="4">
        <Flex justify="between" align="center" mb="4">
          <Heading size="6">Campaign Storage</Heading>
          <Flex gap="2" align="center">
            <Link to={`/campaign/${campaignId}/${isDM ? 'dm' : 'player'}`}>
              <Button variant="soft">Back to Campaign</Button>
            </Link>
            <Button onClick={load} variant="surface">Refresh</Button>
          </Flex>
        </Flex>

        <Card mb="4" variant="surface">
          <Flex p="3" direction="column" gap="3">
            <Flex gap="3" align="center">
              <Text>Filter:</Text>
              <TextField.Root placeholder="object_type (e.g., npc, item)" value={objectType} onChange={(e) => setObjectType(e.target.value)} />
            </Flex>

            {/* Create new storage object (DM) */}
            {isDM && (
              <CreateStorageForm
                campaignId={campaignId}
                onCreated={() => load()}
              />
            )}
          </Flex>
        </Card>

        {error && (
          <Callout.Root color="red" mb="3">
            <Callout.Text>{error}</Callout.Text>
          </Callout.Root>
        )}

        {loading ? (
          <Text color="gray">Loading...</Text>
        ) : (
          <Flex direction="column" gap="3">
            {objects.length === 0 ? (
              <Text color="gray">No objects found.</Text>
            ) : (
              objects.map((obj) => (
                <Card key={`${obj.object_type}:${obj.object_id}`} variant="surface">
                  <Flex p="3" direction="column" gap="2">
                    <Flex justify="between" align="center">
                      <Flex align="center" gap="3">
                        <Heading size="4">{obj.object_name}</Heading>
                        <Badge variant="soft" color="gray">{obj.object_type}</Badge>
                        <Badge variant="soft" color={obj.visibility === 'dm_only' ? 'red' : obj.visibility === 'specific_players' ? 'amber' : 'green'}>
                          {obj.visibility}
                        </Badge>
                      </Flex>
                      <Text size="2" color="gray">id: {obj.object_id}</Text>
                    </Flex>

                    <Separator my="2" />

                    <StorageACLManager
                      campaignId={String(campaignId)}
                      objectType={obj.object_type}
                      objectId={obj.object_id}
                      visibility={obj.visibility}
                      isDM={isDM}
                    />
                  </Flex>
                </Card>
              ))
            )}
          </Flex>
        )}
      </Container>
    </Box>
  );
}



function CreateStorageForm(props: { campaignId: string; onCreated: () => void }) {
  const { campaignId, onCreated } = props;
  const [objectType, setObjectType] = useState("");
  const [objectId, setObjectId] = useState("");
  const [objectName, setObjectName] = useState("");
  const [visibility, setVisibility] = useState<'dm_only'|'all_players'|'specific_players'>("dm_only");
  const [category, setCategory] = useState("");
  const [tagsInput, setTagsInput] = useState("");
  const [dataText, setDataText] = useState("{}");
  const [source, setSource] = useState("");
  const [sourceId, setSourceId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string|null>(null);

  const currentUserId = getCurrentUserId();

  const handleCreate = async () => {
    try {
      setSubmitting(true);
      setError(null);
      let data: any = {};
      if (dataText.trim()) {
        try { data = JSON.parse(dataText); } catch {
          setError("Invalid JSON in data");
          setSubmitting(false);
          return;
        }
      }
      const tags = tagsInput.split(',').map(s => s.trim()).filter(Boolean);
      const payload = {
        object_type: objectType.trim(),
        object_id: objectId.trim(),
        object_name: objectName.trim(),
        category: category.trim() || undefined,
        tags: tags.length ? tags : undefined,
        data,
        visibility,
        source: source.trim() || undefined,
        source_id: sourceId.trim() || undefined,
        created_by: currentUserId,
      };
      if (!payload.object_type || !payload.object_id || !payload.object_name) {
        setError("object_type, object_id, object_name are required");
        setSubmitting(false);
        return;
      }
      await CampaignStorageAPI.create(campaignId, payload);
      // reset minimal
      setObjectId("");
      setObjectName("");
      setDataText("{}");
      onCreated();
    } catch (e: any) {
      setError(e?.message || "Create failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card variant="classic">
      <Flex direction="column" gap="2" p="3">
        <Heading size="4">Create New Object</Heading>
        {error && (
          <Callout.Root color="red"><Callout.Text>{error}</Callout.Text></Callout.Root>
        )}
        <Flex gap="2" wrap="wrap">
          <TextField.Root placeholder="object_type" value={objectType} onChange={(e) => setObjectType(e.target.value)} />
          <TextField.Root placeholder="object_id" value={objectId} onChange={(e) => setObjectId(e.target.value)} />
          <TextField.Root placeholder="object_name" value={objectName} onChange={(e) => setObjectName(e.target.value)} />
          <Select.Root value={visibility} onValueChange={(v) => setVisibility(v as any)}>
            <Select.Trigger />
            <Select.Content>
              <Select.Item value="dm_only">dm_only</Select.Item>
              <Select.Item value="all_players">all_players</Select.Item>
              <Select.Item value="specific_players">specific_players</Select.Item>
            </Select.Content>
          </Select.Root>
        </Flex>
        <Flex gap="2" wrap="wrap">
          <TextField.Root placeholder="category (optional)" value={category} onChange={(e) => setCategory(e.target.value)} />
          <TextField.Root placeholder="tags comma separated (optional)" value={tagsInput} onChange={(e) => setTagsInput(e.target.value)} />
        </Flex>
        <textarea
          rows={4}
          placeholder="data (JSON)"
          value={dataText}
          onChange={(e) => setDataText(e.target.value)}
          className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-md text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-amber-500"
        />
        <Flex gap="2" wrap="wrap">
          <TextField.Root placeholder="source (optional)" value={source} onChange={(e) => setSource(e.target.value)} />
          <TextField.Root placeholder="source_id (optional)" value={sourceId} onChange={(e) => setSourceId(e.target.value)} />
        </Flex>
        <Flex justify="end">
          <Button disabled={submitting} onClick={handleCreate}>{submitting ? 'Creating...' : 'Create'}</Button>
        </Flex>
      </Flex>
    </Card>
  );
}
