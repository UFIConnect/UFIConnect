import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import client from '../api/client';
import { useAuth } from './AuthContext';

const SavedItemsContext = createContext(null);
const EMPTY_JOBS = [];

function normalizeJob(job, status = 'saved') {
  return {
    ...job,
    id: job.id || job.jobId,
    status,
    jobContent: job.jobContent || job.description || job.content || '',
  };
}

export function SavedItemsProvider({ children }) {
  const { profile } = useAuth();
  const [savedPostIds, setSavedPostIds] = useState(() => new Set());
  const [jobState, setJobState] = useState({ userId: null, jobs: EMPTY_JOBS });
  const [postBusyIds, setPostBusyIds] = useState(() => new Set());
  const [jobBusyIds, setJobBusyIds] = useState(() => new Set());
  const [ready, setReady] = useState(false);
  const activeUserIdRef = useRef(profile?.id || null);
  activeUserIdRef.current = profile?.id || null;
  const activeSaveScope = useRef({ userId: activeUserIdRef.current });
  if (activeSaveScope.current.userId !== activeUserIdRef.current) activeSaveScope.current = { userId: activeUserIdRef.current };
  const savedJobs = jobState.userId === activeUserIdRef.current ? jobState.jobs : EMPTY_JOBS;

  const setSavedJobs = useCallback((update) => {
    const userId = profile?.id || null;
    setJobState(current => ({
      userId,
      jobs: typeof update === 'function' ? update(current.userId === userId ? current.jobs : EMPTY_JOBS) : update,
    }));
  }, [profile?.id]);

  const refreshSavedPosts = useCallback(async () => {
    if (!profile?.id) {
      setSavedPostIds(new Set());
      return [];
    }
    const userId = profile.id;
    const { data } = await client.get('/saved/posts', { params: { summary: 1 } });
    const ids = (data.postIds || []).map(String);
    if (activeUserIdRef.current === userId) setSavedPostIds(new Set(ids));
    return ids;
  }, [profile?.id]);

  const refreshSavedJobs = useCallback(async () => {
    if (!profile?.id) {
      setSavedJobs([]);
      return [];
    }
    const scope = activeSaveScope.current;
    const { data } = await client.get('/jobs/tracking');
    const jobs = Array.isArray(data.jobs) ? data.jobs : [];
    if (activeSaveScope.current === scope) setSavedJobs(jobs);
    return jobs;
  }, [profile?.id, setSavedJobs]);

  useEffect(() => {
    let cancelled = false;
    if (!profile?.id) {
      setSavedPostIds(new Set());
      setSavedJobs([]);
      setPostBusyIds(new Set());
      setJobBusyIds(new Set());
      setReady(false);
      return undefined;
    }
    // Never leave one member's bookmarks visible while another member's
    // account is hydrating in the same browser session.
    setSavedPostIds(new Set());
    setSavedJobs([]);
    setPostBusyIds(new Set());
    setJobBusyIds(new Set());
    setReady(false);
    Promise.allSettled([refreshSavedPosts(), refreshSavedJobs()])
      .finally(() => { if (!cancelled) setReady(true); });
    return () => { cancelled = true; };
  }, [profile?.id, refreshSavedJobs, refreshSavedPosts, setSavedJobs]);

  const togglePost = useCallback(async (post) => {
    const id = String(post?.id || '');
    const userId = profile?.id || null;
    const scope = activeSaveScope.current;
    if (!userId || activeUserIdRef.current !== userId) throw new Error('Sign in to save this post.');
    if (!id || postBusyIds.has(id)) return null;
    const wasSaved = savedPostIds.has(id);
    setPostBusyIds(current => new Set(current).add(id));
    setSavedPostIds(current => {
      const next = new Set(current);
      if (wasSaved) next.delete(id); else next.add(id);
      return next;
    });
    try {
      if (wasSaved) await client.delete(`/saved/posts/${encodeURIComponent(id)}`);
      else await client.post('/saved/posts', { post });
      return activeSaveScope.current === scope ? !wasSaved : null;
    } catch (error) {
      if (activeSaveScope.current === scope) setSavedPostIds(current => {
        const next = new Set(current);
        if (wasSaved) next.add(id); else next.delete(id);
        return next;
      });
      throw error;
    } finally {
      if (activeSaveScope.current === scope) setPostBusyIds(current => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    }
  }, [postBusyIds, savedPostIds, profile?.id]);

  const saveJob = useCallback(async (job, status = 'saved') => {
    const normalized = normalizeJob(job, status);
    const id = String(normalized.id || '');
    const scope = activeSaveScope.current;
    if (!id || jobBusyIds.has(id)) return null;
    const previous = savedJobs.find(item => String(item.id) === id) || null;
    setJobBusyIds(current => new Set(current).add(id));
    setSavedJobs(current => [normalized, ...current.filter(item => String(item.id) !== id)]);
    try {
      await client.post('/jobs/tracking', {
        jobId: id,
        status,
        title: normalized.title,
        org: normalized.org,
        source: normalized.source,
        sourceUrl: normalized.sourceUrl,
        matchScore: normalized.matchScore,
        jobContent: normalized.jobContent,
        contactEmail: normalized.contactEmail,
        recruiterName: normalized.recruiterName,
        recruiterRole: normalized.recruiterRole,
      });
      return activeSaveScope.current === scope ? normalized : null;
    } catch (error) {
      if (activeSaveScope.current === scope) setSavedJobs(current => {
        const without = current.filter(item => String(item.id) !== id);
        return previous ? [previous, ...without] : without;
      });
      throw error;
    } finally {
      if (activeSaveScope.current === scope) setJobBusyIds(current => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    }
  }, [jobBusyIds, savedJobs, setSavedJobs]);

  const removeJob = useCallback(async (jobId) => {
    const id = String(jobId || '');
    const scope = activeSaveScope.current;
    if (!id || jobBusyIds.has(id)) return false;
    const previous = savedJobs.find(item => String(item.id) === id) || null;
    setJobBusyIds(current => new Set(current).add(id));
    setSavedJobs(current => current.filter(item => String(item.id) !== id));
    try {
      await client.delete(`/jobs/tracking/${encodeURIComponent(id)}`);
      return activeSaveScope.current === scope;
    } catch (error) {
      if (previous && activeSaveScope.current === scope) setSavedJobs(current => [previous, ...current.filter(item => String(item.id) !== id)]);
      throw error;
    } finally {
      if (activeSaveScope.current === scope) setJobBusyIds(current => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    }
  }, [jobBusyIds, savedJobs, setSavedJobs]);

  const jobById = useMemo(
    () => new Map(savedJobs.map(job => [String(job.id), job])),
    [savedJobs]
  );

  const value = useMemo(() => ({
    ready,
    savedPostIds,
    savedJobs,
    postBusyIds,
    jobBusyIds,
    isPostSaved: postId => savedPostIds.has(String(postId || '')),
    getJob: jobId => jobById.get(String(jobId || '')) || null,
    togglePost,
    saveJob,
    removeJob,
    refreshSavedPosts,
    refreshSavedJobs,
  }), [jobBusyIds, jobById, postBusyIds, ready, refreshSavedJobs, refreshSavedPosts, removeJob, saveJob, savedJobs, savedPostIds, togglePost]);

  return <SavedItemsContext.Provider value={value}>{children}</SavedItemsContext.Provider>;
}

export function useSavedItems() {
  const context = useContext(SavedItemsContext);
  if (!context) throw new Error('useSavedItems must be used inside SavedItemsProvider');
  return context;
}
